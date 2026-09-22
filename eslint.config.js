import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  // Data-access boundary (MOSAI pack T2.2 / ADR-2). A feature module must not
  // read the projects table to authorize a record; that tenancy read lives only
  // in the guards/dal layer. Use orgQuery/orgMutation/orgAction and their
  // `access.requireProject()` / `access.ownedProject()` / `access.ownedRow()`
  // helpers, or `guards.projectAccessFor()` for internal helpers.
  {
    files: ["src/convex/**/*.ts"],
    ignores: [
      "src/convex/guards.ts",
      "src/convex/dal.ts",
      "src/convex/organizations.ts",
      "src/convex/projects.ts",
      "src/convex/billing.ts",
      "src/convex/lib/**",
      "src/convex/_generated/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.object.name='ctx'][callee.object.property.name='db'][callee.property.name='get'][arguments.0.name='projectId']",
          message:
            "Raw ctx.db project lookup is banned outside the data-access layer. Authorize through access.requireProject()/ownedProject() (orgQuery/orgMutation/orgAction) or guards.projectAccessFor().",
        },
        {
          selector:
            "CallExpression[callee.object.object.name='ctx'][callee.object.property.name='db'][callee.property.name='query'][arguments.0.value='projects']",
          message:
            "Raw ctx.db.query('projects') is banned outside the data-access layer (the projects module and guards/dal own it). Use the org access helpers.",
        },
      ],
    },
  },
);
