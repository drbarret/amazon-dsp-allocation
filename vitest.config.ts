import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Run test files sequentially. Multiple integration suites create and
    // remove disposable rows and assert global row counts (e.g. 125 users);
    // running them in parallel makes those count assertions racy.
    fileParallelism: false,
  },
});
