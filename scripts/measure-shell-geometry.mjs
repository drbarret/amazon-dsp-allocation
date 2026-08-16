#!/usr/bin/env node
// DEVELOPMENT-ONLY: measure shell geometry (mobile top bar, sidebar, main,
// horizontal overflow) across breakpoints. Creates a temp SUPERVISOR user,
// forges an Auth.js JWT session cookie, measures, then cleans up and verifies
// DB restoration. Usage: node scripts/measure-shell-geometry.mjs [--shot]

import { chromium } from "playwright";
import { EncryptJWT, base64url, calculateJwkThumbprint } from "jose";
import { hkdf } from "@panva/hkdf";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

try { process.loadEnvFile(".env.local"); } catch { try { process.loadEnvFile(".env"); } catch {} }

const AUTH_SECRET = process.env.AUTH_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.MEASURE_BASE_URL ?? "http://localhost:3100";
const TAKE_SHOTS = process.argv.includes("--shot");

if (!AUTH_SECRET || !DATABASE_URL) {
  console.error("AUTH_SECRET and DATABASE_URL must be set");
  process.exit(1);
}

const SHOT_DIR = join(process.cwd(), "docs", "screenshots", "shell-geometry");
if (TAKE_SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

const { Client } = pg;
const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

function count(table) {
  return client.query(`SELECT COUNT(*)::int AS c FROM "${table}"`).then((r) => r.rows[0].c);
}

async function snapshot() {
  return {
    users: await count("users"),
    allowed_emails: await count("allowed_emails"),
  };
}

async function forgeJWT(payload, salt) {
  const enc = "A256CBC-HS512";
  const saltBytes = new TextEncoder().encode(salt);
  const encryptionSecret = await hkdf(
    "sha256",
    AUTH_SECRET,
    saltBytes,
    `Auth.js Generated Encryption Key (${salt})`,
    64,
  );
  const thumbprint = await calculateJwkThumbprint(
    { kty: "oct", k: base64url.encode(encryptionSecret) },
    "sha512",
  );
  const now = Math.floor(Date.now() / 1000);
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc, kid: thumbprint })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setJti(randomUUID())
    .encrypt(encryptionSecret);
}

const initial = await snapshot();
console.log("INITIAL counts:", JSON.stringify(initial));

const UID = "shell-measure-temp";
const EMAIL = "shell-measure@instalog.com.br";

await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [EMAIL]);
await client.query(`DELETE FROM "users" WHERE id = $1`, [UID]);
await client.query(
  `INSERT INTO "users" ("id", "email", "name", "role", "active", "createdAt", "updatedAt")
   VALUES ($1, $2, 'Shell Measure', 'SUPERVISOR', true, now(), now())`,
  [UID, EMAIL],
);
await client.query(
  `INSERT INTO "allowed_emails" ("id", "email", "role", "status", "createdAt", "updatedAt")
   VALUES (gen_random_uuid(), $1, 'SUPERVISOR', 'ACTIVE', now(), now())`,
  [EMAIL],
);

const cookieName = "authjs.session-token";
const token = await forgeJWT(
  {
    id: UID,
    email: EMAIL,
    name: "Shell Measure",
    role: "SUPERVISOR",
    active: true,
    roleLastFetched: Date.now(),
  },
  cookieName,
);

const browser = await chromium.launch({ headless: true });

const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "bp-639", width: 639, height: 844 },
  { name: "bp-640", width: 640, height: 844 },
  { name: "bp-899", width: 899, height: 844 },
  { name: "bp-900", width: 900, height: 844 },
  { name: "bp-1023", width: 1023, height: 844 },
  { name: "bp-1024", width: 1024, height: 844 },
  { name: "bp-1100", width: 1100, height: 844 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

const PAGES = [
  { path: "/dashboard", slug: "dashboard" },
  { path: "/drivers", slug: "drivers" },
];

const results = [];

for (const pgDef of PAGES) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ignoreHTTPSErrors: true,
    });
    await context.addCookies([
      {
        name: cookieName,
        value: token,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}${pgDef.path}`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(1200);

      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const docScrollW = document.documentElement.scrollWidth;
        const bodyScrollW = document.body.scrollWidth;

        // Mobile top bar: the sticky lg:hidden div rendered by AppSidebar
        const topBar = document.querySelector("div.sticky.top-0.z-40.lg\\:hidden");
        // Desktop sidebar aside
        const aside = document.querySelector("aside");
        const main = document.querySelector("main");
        // The flex shell container
        const shell = main ? main.parentElement : null;

        const rect = (el) =>
          el
            ? {
                x: Math.round(el.getBoundingClientRect().x * 100) / 100,
                y: Math.round(el.getBoundingClientRect().y * 100) / 100,
                w: Math.round(el.getBoundingClientRect().width * 100) / 100,
                h: Math.round(el.getBoundingClientRect().height * 100) / 100,
              }
            : null;

        const shellDisplay = shell ? getComputedStyle(shell).display : null;
        const shellDir = shell ? getComputedStyle(shell).flexDirection : null;

        return {
          vw,
          docScrollW,
          bodyScrollW,
          horizontalOverflow: Math.max(docScrollW, bodyScrollW) > vw,
          topBar: rect(topBar),
          topBarVisible: topBar ? getComputedStyle(topBar).display !== "none" : false,
          aside: rect(aside),
          asideVisible: aside ? getComputedStyle(aside).display !== "none" : false,
          main: rect(main),
          shellDisplay,
          shellDir,
          activeNav: document.querySelector('[aria-current="page"]')?.textContent?.trim() ?? null,
        };
      });

      const row = { page: pgDef.slug, viewport: vp.name, ...m };
      results.push(row);
      console.log(JSON.stringify(row));

      if (TAKE_SHOTS) {
        await page.screenshot({
          path: join(SHOT_DIR, `${pgDef.slug}-${vp.name}.png`),
          fullPage: false,
        });
      }
    } catch (e) {
      console.error(`FAILED ${pgDef.slug} @ ${vp.name}: ${e.message}`);
    } finally {
      await context.close();
    }
  }
}

await browser.close();

// Cleanup
await client.query(`DELETE FROM "allowed_emails" WHERE email = $1`, [EMAIL]);
await client.query(`DELETE FROM "users" WHERE id = $1`, [UID]);

const final = await snapshot();
console.log("FINAL counts:", JSON.stringify(final));
const restored = initial.users === final.users && initial.allowed_emails === final.allowed_emails;
if (!restored) {
  console.error("FATAL: DB state NOT restored");
  process.exit(1);
}
console.log("DB state fully restored.");
await client.end();
