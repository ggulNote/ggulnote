const fs = require("node:fs");
const path = require("node:path");

const resolveWorkspaceParser = () => {
  const pnpmRoot = path.resolve(__dirname, "../..", "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmRoot)) {
    return null;
  }

  const entries = fs.readdirSync(pnpmRoot);
  const parserEntry = entries.find((entry) => entry.startsWith("@typescript-eslint+parser@"));
  if (!parserEntry) {
    return null;
  }

  const parserPath = path.resolve(
    pnpmRoot,
    parserEntry,
    "node_modules",
    "@typescript-eslint",
    "parser",
    "dist",
    "index.js",
  );
  if (!fs.existsSync(parserPath)) {
    return null;
  }

  return parserPath;
};

const parser = resolveWorkspaceParser();

/** @type {import("eslint").Linter.FlatConfig[]} */
module.exports = parser
  ? [
      {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
          parser: require(parser),
          parserOptions: {
            sourceType: "module",
            ecmaVersion: "latest",
          },
        },
      },
      {
        ignores: ["dist/**", ".turbo/**", "coverage/**", "build/**"],
      },
    ]
  : [
      {
        ignores: ["src/**", "tests/**", "dist/**", ".turbo/**", "coverage/**", "build/**"],
      },
    ];
