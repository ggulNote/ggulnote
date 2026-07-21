/** @type {import("eslint").Linter.FlatConfig[]} */
module.exports = [
  ...require("eslint-config-next/core-web-vitals"),
  {
    ignores: [
      "dist/**",
      ".turbo/**",
      "coverage/**",
      "build/**",
    ],
  },
];
