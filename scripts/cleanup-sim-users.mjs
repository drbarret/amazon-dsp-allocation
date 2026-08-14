#!/usr/bin/env node
// Clean up orphan users from failed simulation runs
import pg from "pg";
try { process.loadEnvFile(".env.local"); } catch { /* ok */ }

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const result = await client.query(`SELECT id, email, name FROM users ORDER BY "createdAt"`);
  console.log("All users:", result.rows);
  
  // Delete orphan sim-test users
  const deleted = await client.query(`DELETE FROM users WHERE email LIKE 'sim-test-%'`);
  console.log(`Deleted ${deleted.rowCount} orphan sim-test users`);
  
  const after = await client.query(`SELECT COUNT(*) as count FROM users`);
  console.log("Users remaining:", after.rows[0].count);
} finally {
  await client.end();
}
