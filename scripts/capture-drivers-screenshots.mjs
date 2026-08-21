#!/usr/bin/env node
// Captura screenshots da página /drivers em produção (390 e 1440)
// Usa cookie forjado contra https://amazon-dsp-allocation.vercel.app

import { chromium } from "playwright";
import { EncryptJWT, base64url, calculateJwkThumbprint } from "jose";
import { hkdf } from "@panva/hkdf";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

try { process.loadEnvFile(".env.local"); } catch { try { process.loadEnvFile(".env"); } catch {} }

const PROD_URL = "https://amazon-dsp-allocation.vercel.app";
const AUTH_SECRET = process.env.AUTH_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!AUTH_SECRET || !DATABASE_URL) {
  console.error("AUTH_SECRET and DATABASE_URL required");
  process.exit(1);
}

const SCREENSHOT_DIR = join(process.cwd(), "docs", "screenshots", "drivers");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const COOKIE_NAME = "__Secure-authjs.session-token";

async function forgeJWT(payload) {
  const enc = "A256CBC-HS512";
  const key = await hkdf(
    "sha256",
    AUTH_SECRET,
    new TextEncoder().encode(COOKIE_NAME),
    `Auth.js Generated Encryption Key (${COOKIE_NAME})`,
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

const { Client } = pg;
const db = new Client({ connectionString: DATABASE_URL });
await db.connect();

// Find a real admin to use for screenshots (no supervisor in prod)
const supResult = await db.query(
  `SELECT id, email, name, role, "transportCompanyId" FROM users WHERE role = 'ADMIN' AND active = true LIMIT 1`
);
if (supResult.rows.length === 0) {
  console.error("No active admin found");
  process.exit(1);
}
const sup = supResult.rows[0];
console.log(`Using admin: ${sup.name} (${sup.email})`);

const supToken = await forgeJWT({
  id: sup.id,
  email: sup.email,
  name: sup.name,
  role: sup.role,
  active: true,
  transportCompanyId: sup.transportCompanyId,
  roleLastFetched: Date.now(),
});

const browser = await chromium.launch({ headless: true });

async function capture(name, path, width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addCookies([{
    name: COOKIE_NAME,
    value: supToken,
    domain: "amazon-dsp-allocation.vercel.app",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  const page = await context.newPage();
  await page.goto(`${PROD_URL}${path}`, { waitUntil: "networkidle", timeout: 30000 });
  
  // Hide Next.js dev overlay
  await page.addStyleTag({
    content: `nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay] { display: none !important; }`,
  });
  
  const filename = `${name}-${width}x${height}.png`;
  const filepath = join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`Captured: ${filepath}`);
  await context.close();
  return filepath;
}

const screenshots = [];

try {
  // /drivers ativos
  screenshots.push(await capture("drivers-active", "/drivers?status=active", 390, 844));
  screenshots.push(await capture("drivers-active", "/drivers?status=active", 1440, 900));
  
  // /drivers inativos
  screenshots.push(await capture("drivers-inactive", "/drivers?status=inactive", 390, 844));
  screenshots.push(await capture("drivers-inactive", "/drivers?status=inactive", 1440, 900));
  
  // /drivers/deactivation-requests
  screenshots.push(await capture("deactivation-requests", "/drivers/deactivation-requests", 390, 844));
  screenshots.push(await capture("deactivation-requests", "/drivers/deactivation-requests", 1440, 900));
  
  // Modal de edição aberto (clicar no primeiro botão de editar)
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{
      name: COOKIE_NAME,
      value: supToken,
      domain: "amazon-dsp-allocation.vercel.app",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    }]);
    const page = await context.newPage();
    await page.goto(`${PROD_URL}/drivers?status=active`, { waitUntil: "networkidle", timeout: 30000 });
    
    // Click first edit button
    const editBtn = page.locator('button[aria-label^="Editar"]').first();
    if (await editBtn.count() > 0) {
      await editBtn.click();
      await page.waitForTimeout(500);
      
      const filepath = join(SCREENSHOT_DIR, "edit-modal-1440x900.png");
      await page.screenshot({ path: filepath, fullPage: false });
      console.log(`Captured: ${filepath}`);
      screenshots.push(filepath);
    } else {
      console.log("No edit button found - skipping modal screenshot");
    }
    await context.close();
  }
  
  console.log("\nAll screenshots captured successfully.");
  console.log("Paths:", screenshots.join("\n"));
} finally {
  await browser.close();
  await db.end();
}
