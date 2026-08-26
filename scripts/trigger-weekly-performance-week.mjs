/** @format */

/**
 * Manual trigger for the weekly-performance-week cron endpoint.
 * Usage:
 *   node scripts/trigger-weekly-performance-week.mjs
 *
 * Requires CRON_SECRET and (optionally) BASE_URL environment variables.
 */

const BASE_URL =
  process.env.BASE_URL || "https://amazon-dsp-allocation.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

const url = `${BASE_URL}/api/cron/weekly-performance-week`;
console.log(`Triggering ${url} ...`);

const res = await fetch(url, {
  method: "GET",
  headers: {
    Authorization: `Bearer ${CRON_SECRET}`,
  },
});

const body = await res.json().catch(() => ({}));
console.log(`Status: ${res.status}`);
console.log(JSON.stringify(body, null, 2));

if (!res.ok || body.success === false) {
  process.exit(1);
}
