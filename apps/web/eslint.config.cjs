/** @type {import("eslint").Linter.FlatConfig[]} */
module.exports = [
  ...require("eslint-config-next/core-web-vitals"),
  {
    ignores: [
      ".next/**",
      ".turbo/**",
      "coverage/**",
      "dist/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "pnpm-lock.yaml",
    ],
  },
];
