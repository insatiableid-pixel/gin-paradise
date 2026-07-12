import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        statements: 35,
        branches: 25,
        functions: 30,
        lines: 35,
      },
    },
    // Each test file gets a fresh server + database
    fileParallelism: false,
  },
});
