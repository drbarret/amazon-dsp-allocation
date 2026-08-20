import { test, expect, type Browser, type Page } from "playwright/test";
import { EncryptJWT, base64url, calculateJwkThumbprint } from "jose";
import { hkdf } from "@panva/hkdf";
import pg from "pg";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import XLSX from "xlsx";

try {
  process.loadEnvFile(".env.local");
} catch {
  try {
    process.loadEnvFile(".env");
  } catch {}
}

const SKIP_E2E = (process.env.SKIP_E2E_TESTS ?? "").trim() === "1";
const AUTH_SECRET = process.env.AUTH_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

const UID = "e2e-disponibilidades-temp";
const TCID = "e2e-disponibilidades-tc";
const WEEKID = "e2e-disponibilidades-week";
const EMAIL = "e2e-disponibilidades@instalog.com.br";
const ACTIVE_DRIVER_EMAIL = "e2e-disponibilidades-active@instalog.com.br";
const INACTIVE_DRIVER_EMAIL = "e2e-disponibilidades-inactive@instalog.com.br";
const COOKIE = "authjs.session-token";

async function forgeJWT(payload: Record<string, unknown>): Promise<string> {
  const enc = "A256CBC-HS512";
  const key = await hkdf(
    "sha256",
    AUTH_SECRET!,
    new TextEncoder().encode(COOKIE),
    `Auth.js Generated Encryption Key (${COOKIE})`,
    64,
  );
  const kid = await calculateJwkThumbprint(
    { kty: "oct", k: base64url.encode(key) },
    "sha512",
  );
  const now = Math.floor(Date.now() / 1000);
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc, kid })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setJti(randomUUID())
    .encrypt(key);
}

async function headRedirect(url: string): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: "HEAD" }, (res) => {
      resolve({ status: res.statusCode ?? 0, location: res.headers["location"] ?? null });
    });
    req.on("error", reject);
    req.end();
  });
}

async function withAuthenticatedPage(
  browser: Browser,
  callback: (page: Page) => Promise<void>,
  token: string,
): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addCookies([
    {
      name: COOKIE,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  try {
    await callback(page);
  } finally {
    await context.close();
  }
}

test.describe("disponibilidades UI", () => {
  test.skip(SKIP_E2E, "SKIP_E2E_TESTS=1 configurado");

  let client: pg.Client;
  let token: string;

  test.beforeAll(async () => {
    if (!AUTH_SECRET || !DATABASE_URL) {
      throw new Error(
        "E2E disponibilidades tests require AUTH_SECRET and DATABASE_URL. " +
          "Set them, or opt out explicitly with SKIP_E2E_TESTS=1.",
      );
    }
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query(`SELECT 1`);

    // Clean up any leftover rows from previous interrupted runs.
    await client.query(`DELETE FROM "availability_approvals" WHERE "driverAvailabilityId" IN (
      SELECT id FROM "driver_availabilities" WHERE "dispatchWeekId" = $1
    )`, [WEEKID]);
    await client.query(`DELETE FROM "driver_availabilities" WHERE "dispatchWeekId" = $1`, [WEEKID]);
    await client.query(`DELETE FROM "dispatch_weeks" WHERE id = $1`, [WEEKID]);
    await client.query(`DELETE FROM "allowed_emails" WHERE email = ANY($1)`, [
      [EMAIL, ACTIVE_DRIVER_EMAIL, INACTIVE_DRIVER_EMAIL],
    ]);
    await client.query(`DELETE FROM "users" WHERE id = ANY($1)`, [
      [UID, "e2e-disponibilidades-active", "e2e-disponibilidades-inactive"],
    ]);
    await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [TCID]);

    await client.query(
      `INSERT INTO "transport_companies" ("id", "name", "createdAt", "updatedAt")
       VALUES ($1, 'E2E Disponibilidades Transport', now(), now())`,
      [TCID],
    );

    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "transportCompanyId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E Supervisor', 'SUPERVISOR', true, $3, now(), now())`,
      [UID, EMAIL, TCID],
    );
    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "transportCompanyId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E Active Driver', 'DRIVER', true, $3, now(), now())`,
      ["e2e-disponibilidades-active", ACTIVE_DRIVER_EMAIL, TCID],
    );
    await client.query(
      `INSERT INTO "users" ("id", "email", "name", "role", "active", "transportCompanyId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'E2E Inactive Driver', 'DRIVER', false, $3, now(), now())`,
      ["e2e-disponibilidades-inactive", INACTIVE_DRIVER_EMAIL, TCID],
    );

    for (const userEmail of [EMAIL, ACTIVE_DRIVER_EMAIL, INACTIVE_DRIVER_EMAIL]) {
      const role = userEmail === EMAIL ? "SUPERVISOR" : "DRIVER";
      await client.query(
        `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now())`,
        [userEmail, role],
      );
    }

    await client.query(
      `INSERT INTO "dispatch_weeks"
         ("id", "transportCompanyId", "weekKey", "year", "weekNumber", "startDate", "endDate", "status", "createdById", "createdAt", "updatedAt")
       VALUES ($1, $2, 'WK-E2E-DISP', 2026, 35, '2026-08-30', '2026-09-05', 'PLANNING', $3, now(), now())`,
      [WEEKID, TCID, UID],
    );

    token = await forgeJWT({
      id: UID,
      email: EMAIL,
      name: "E2E Supervisor",
      role: "SUPERVISOR",
      active: true,
      transportCompanyId: TCID,
      roleLastFetched: Date.now(),
    });
  });

  test.afterAll(async () => {
    if (client) {
      await client.query(`DELETE FROM "availability_approvals" WHERE "driverAvailabilityId" IN (
        SELECT id FROM "driver_availabilities" WHERE "dispatchWeekId" = $1
      )`, [WEEKID]);
      await client.query(`DELETE FROM "driver_availabilities" WHERE "dispatchWeekId" = $1`, [WEEKID]);
      await client.query(`DELETE FROM "dispatch_weeks" WHERE id = $1`, [WEEKID]);
      await client.query(`DELETE FROM "allowed_emails" WHERE email = ANY($1)`, [
        [EMAIL, ACTIVE_DRIVER_EMAIL, INACTIVE_DRIVER_EMAIL],
      ]);
      await client.query(`DELETE FROM "users" WHERE id = ANY($1)`, [
        [UID, "e2e-disponibilidades-active", "e2e-disponibilidades-inactive"],
      ]);
      await client.query(`DELETE FROM "transport_companies" WHERE id = $1`, [TCID]);
      await client.end();
    }
  });

  test("/dispatch redireciona permanentemente para /disponibilidades", async () => {
    const result = await headRedirect(`${BASE_URL}/dispatch`);

    expect([301, 308]).toContain(result.status);
    expect(result.location).toMatch(/\/disponibilidades/);
  });

  test("menu exibe Disponibilidades para supervisor", async ({ browser }) => {
    await withAuthenticatedPage(
      browser,
      async (page) => {
        await page.goto(`${BASE_URL}/disponibilidades`, { waitUntil: "networkidle" });
        await expect(page.getByRole("link", { name: /Disponibilidades/i })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Disponibilidades", exact: true })).toBeVisible();
      },
      token,
    );
  });

  test("download do modelo gera arquivo .xlsx", async ({ browser }) => {
    await withAuthenticatedPage(
      browser,
      async (page) => {
        await page.goto(`${BASE_URL}/disponibilidades`, { waitUntil: "networkidle" });

        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.getByRole("button", { name: /Baixar modelo/i }).click(),
        ]);

        const filePath = await download.path();
        expect(filePath).toBeTruthy();
        const stats = fs.statSync(filePath!);
        expect(stats.size).toBeGreaterThan(0);
      },
      token,
    );
  });

  test("upload de arquivo exibe resumo", async ({ browser }) => {
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, `disponibilidades-test-${Date.now()}.xlsx`);
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        "Carimbo de data/hora",
        "Endereço de e-mail",
        "Nome completo",
        "CPF",
        "GNV?",
        "Passeio?",
        "Dom",
        "Seg",
        "Ter",
        "Qua",
        "Qui",
        "Sex",
        "Sáb",
        "Speed?",
      ],
      [
        "18/08/2026 14:30:00",
        ACTIVE_DRIVER_EMAIL,
        "Motorista Teste",
        "123.456.789-09",
        "Sim",
        "Não",
        "Sim",
        "Sim",
        "Sim",
        "Sim",
        "Sim",
        "Sim",
        "Não",
        "Sim",
      ],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Respostas");
    fs.writeFileSync(
      filePath,
      Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })),
    );

    try {
      await withAuthenticatedPage(
        browser,
        async (page) => {
          await page.goto(`${BASE_URL}/disponibilidades`, { waitUntil: "networkidle" });

          await page.getByRole("button", { name: /Importar disponibilidades/i }).click();
          await page.getByLabel(/Arquivo \.xlsx/i).setInputFiles(filePath);
          await page.getByRole("button", { name: /^Importar$/i }).click();

          await expect(page.getByText(/Importado:/i)).toBeVisible({ timeout: 10_000 });
        },
        token,
      );
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });

  test("aprovação de motorista inativo", async ({ browser }) => {
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, `disponibilidades-inactive-${Date.now()}.xlsx`);
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        "Carimbo de data/hora",
        "Endereço de e-mail",
        "Nome completo",
        "CPF",
        "GNV?",
        "Passeio?",
        "Dom",
        "Seg",
        "Ter",
        "Qua",
        "Qui",
        "Sex",
        "Sáb",
        "Speed?",
      ],
      [
        "18/08/2026 14:30:00",
        INACTIVE_DRIVER_EMAIL,
        "Motorista Inativo",
        "123.456.789-09",
        "Sim",
        "Não",
        "Sim",
        "Sim",
        "Sim",
        "Sim",
        "Sim",
        "Sim",
        "Não",
        "Sim",
      ],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Respostas");
    fs.writeFileSync(
      filePath,
      Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })),
    );

    try {
      await withAuthenticatedPage(
        browser,
        async (page) => {
          await page.goto(`${BASE_URL}/disponibilidades`, { waitUntil: "networkidle" });

          await page.getByRole("button", { name: /Importar disponibilidades/i }).click();
          await page.getByLabel(/Arquivo \.xlsx/i).setInputFiles(filePath);
          await page.getByRole("button", { name: /^Importar$/i }).click();

          await expect(
            page.getByText(/Importado: \d+ ativo\(s\), \d+ pendente\(s\)\./i),
          ).toBeVisible({ timeout: 10_000 });
          await expect(page.getByText(/Aprovações pendentes/i)).toBeVisible();

          await page
            .getByRole("button", { name: /Aprovar E2E Inactive Driver/i })
            .click();

          await expect(page.getByText(/Motorista aprovado/i)).toBeVisible({ timeout: 10_000 });
        },
        token,
      );
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });

  test("edição inline altera disponibilidade", async ({ browser }) => {
    await withAuthenticatedPage(
      browser,
      async (page) => {
        await page.goto(`${BASE_URL}/disponibilidades`, { waitUntil: "networkidle" });

        // First import an active driver row so we have something to edit.
        const tmpDir = os.tmpdir();
        const filePath = path.join(tmpDir, `disponibilidades-edit-${Date.now()}.xlsx`);
        const worksheet = XLSX.utils.aoa_to_sheet([
          [
            "Carimbo de data/hora",
            "Endereço de e-mail",
            "Nome completo",
            "CPF",
            "GNV?",
            "Passeio?",
            "Dom",
            "Seg",
            "Ter",
            "Qua",
            "Qui",
            "Sex",
            "Sáb",
            "Speed?",
          ],
          [
            "18/08/2026 14:30:00",
            ACTIVE_DRIVER_EMAIL,
            "Motorista Teste",
            "123.456.789-09",
            "Sim",
            "Não",
            "Sim",
            "Sim",
            "Sim",
            "Sim",
            "Sim",
            "Sim",
            "Não",
            "Sim",
          ],
        ]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Respostas");
        fs.writeFileSync(
          filePath,
          Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })),
        );

        try {
          await page.getByRole("button", { name: /Importar disponibilidades/i }).click();
          await page.getByLabel(/Arquivo \.xlsx/i).setInputFiles(filePath);
          await page.getByRole("button", { name: /^Importar$/i }).click();
          await expect(page.getByText(/Importado:/i)).toBeVisible({ timeout: 10_000 });

          // Start editing the active driver row.
          await page.getByRole("button", { name: /Editar E2E Active Driver/i }).click();

          // Toggle Monday off.
          await page.getByLabel(/Seg E2E Active Driver/i).uncheck();
          // Toggle GNV off.
          await page.getByLabel(/GNV E2E Active Driver/i).uncheck();

          await page.getByRole("button", { name: /Salvar/i }).click();
          await expect(page.getByText(/Disponibilidade atualizada/i)).toBeVisible({ timeout: 10_000 });

          // Verify visual state changed (Monday should now show "—").
          const monCell = page.locator("table").first().locator("tr").filter({ hasText: /E2E Active Driver/i }).locator("td").nth(2);
          await expect(monCell).toHaveText("—");
        } finally {
          fs.rmSync(filePath, { force: true });
        }
      },
      token,
    );
  });

  test("limpar semana remove todas as disponibilidades", async ({ browser }) => {
    await withAuthenticatedPage(
      browser,
      async (page) => {
        await page.goto(`${BASE_URL}/disponibilidades`, { waitUntil: "networkidle" });

        // First import a row so the button is enabled.
        const tmpDir = os.tmpdir();
        const filePath = path.join(tmpDir, `disponibilidades-clear-${Date.now()}.xlsx`);
        const worksheet = XLSX.utils.aoa_to_sheet([
          [
            "Carimbo de data/hora",
            "Endereço de e-mail",
            "Nome completo",
            "CPF",
            "GNV?",
            "Passeio?",
            "Dom",
            "Seg",
            "Ter",
            "Qua",
            "Qui",
            "Sex",
            "Sáb",
            "Speed?",
          ],
          [
            "18/08/2026 14:30:00",
            ACTIVE_DRIVER_EMAIL,
            "Motorista Teste",
            "123.456.789-09",
            "Sim",
            "Não",
            "Sim",
            "Sim",
            "Sim",
            "Sim",
            "Sim",
            "Sim",
            "Não",
            "Sim",
          ],
        ]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Respostas");
        fs.writeFileSync(
          filePath,
          Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })),
        );

        try {
          await page.getByRole("button", { name: /Importar disponibilidades/i }).click();
          await page.getByLabel(/Arquivo \.xlsx/i).setInputFiles(filePath);
          await page.getByRole("button", { name: /^Importar$/i }).click();
          await expect(page.getByText(/Importado:/i)).toBeVisible({ timeout: 10_000 });

          await page.getByRole("button", { name: /Limpar semana/i }).first().click();
          await expect(page.getByText(/Tem certeza que deseja remover todas as disponibilidades/i)).toBeVisible({ timeout: 10_000 });
          await page.getByRole("button", { name: /^Limpar semana$/i }).last().click();

          await expect(page.getByText(/disponibilidade\(s\) removida\(s\)/i)).toBeVisible({ timeout: 10_000 });
          await expect(page.getByText(/Nenhuma disponibilidade importada para esta semana/i)).toBeVisible();
        } finally {
          fs.rmSync(filePath, { force: true });
        }
      },
      token,
    );
  });
});
