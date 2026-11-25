import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Postgres-backed suites share one database; run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
