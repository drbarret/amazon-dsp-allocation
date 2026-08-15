import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Run test files sequentially. Integration suites capture a row-count
    // baseline in beforeAll and assert restoration in afterAll; when two
    // suites run in parallel, one can capture its baseline before the other
    // creates disposable rows and then observe those rows as "residue" in its
    // afterAll (verified: parallel runs fail intermittently with e.g.
    // "expected 128 to be 125"). Sequential execution keeps the baseline
    // assertions deterministic.
    fileParallelism: false,
  },
});
