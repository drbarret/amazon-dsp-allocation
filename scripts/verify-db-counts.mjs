#!/usr/bin/env node
// Verify production DB state: 1 user, 9 allowed_emails
import pg from "pg";
try { process.loadEnvFile(".env.local"); } catch { /* ok */ }

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const users = await client.query(`SELECT COUNT(*)::int as count FROM users`);
  const allowed = await client.query(`SELECT COUNT(*)::int as count FROM allowed_emails`);
  const activeAllowed = await client.query(`SELECT COUNT(*)::int as count FROM allowed_emails WHERE status = 'ACTIVE'`);
  
  console.log(`Users: ${users.rows[0].count}`);
  console.log(`Allowed emails (total): ${allowed.rows[0].count}`);
  console.log(`Allowed emails (ACTIVE): ${activeAllowed.rows[0].count}`);
  
  console.assert(users.rows[0].count === 1, `Expected 1 user, got ${users.rows[0].count}`);
  console.assert(allowed.rows[0].count === 9, `Expected 9 allowed_emails, got ${allowed.rows[0].count}`);
  console.assert(activeAllowed.rows[0].count === 9, `Expected 9 ACTIVE allowed_emails, got ${activeAllowed.rows[0].count}`);
  
  console.log("\n✅ Production DB counts verified.");
} finally {
  await client.end();
}
