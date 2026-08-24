#!/usr/bin/env node

/**
 * Gatilho manual para /api/cron/weekly-dispatch-week em produção.
 *
 * Uso:
 *   node scripts/trigger-weekly-dispatch-week.mjs
 *
 * Pré-requisitos em .env.local:
 *   - PROD_URL=https://amazon-dsp-allocation.vercel.app
 *   - CRON_SECRET=<o mesmo valor configurado no Vercel>
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  try {
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) {
        const [, key, value] = match;
        if (process.env[key] === undefined) {
          process.env[key] = value.replace(/^["']|["']$/g, "");
        }
      }
    }
  } catch {
    // ignore missing file
  }
}

const envLocalPath = resolve(process.cwd(), ".env.local");
const envPath = resolve(process.cwd(), ".env");

loadEnvFile(envLocalPath);
loadEnvFile(envPath);

const PROD_URL = process.env.PROD_URL;
const CRON_SECRET = process.env.CRON_SECRET;

if (!PROD_URL) {
  console.error("PROD_URL is required (e.g. https://amazon-dsp-allocation.vercel.app)");
  process.exit(1);
}

if (!CRON_SECRET) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

const url = new URL("/api/cron/weekly-dispatch-week", PROD_URL).toString();

console.log(`Triggering ${url} ...`);

const response = await fetch(url, {
  method: "GET",
  headers: {
    Authorization: `Bearer ${CRON_SECRET}`,
  },
});

const bodyText = await response.text();
let body;
try {
  body = JSON.parse(bodyText);
} catch {
  body = bodyText;
}

console.log(`Status: ${response.status}`);
console.log("Response:", body);

if (!response.ok) {
  process.exit(1);
}
