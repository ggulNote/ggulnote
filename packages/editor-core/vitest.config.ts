import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist", ".turbo", ".next", "coverage"],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
