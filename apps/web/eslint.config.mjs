import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    ".turbo/**",
    "coverage/**",
    "dist/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "pnpm-lock.yaml",
  ]),
]);

export default eslintConfig;

