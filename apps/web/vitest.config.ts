import { defineConfig } from "vitest/config";
import path from "node:path";

const rootDir = process.cwd();

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "coverage", ".turbo"],
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
});

