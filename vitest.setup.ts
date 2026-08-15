import path from "node:path";

// Load local env before any test module imports the Prisma client, so
// integration tests can reach the real database. Unit tests mock prisma and
// are unaffected. Falls back silently when .env.local is absent (e.g. CI).
try {
  process.loadEnvFile(path.resolve(process.cwd(), ".env.local"));
} catch {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // no env file; integration tests will skip via reachability check
  }
}
