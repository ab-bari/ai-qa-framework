// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Component isolation (plan §2): pipeline components communicate ONLY via
 * artifacts on disk. Their source may import shared infrastructure
 * (src/core, src/llm, src/schemas) and shared read/write libraries
 * (src/coverage, src/reporter) — never another pipeline component.
 * src/cli is the composition root and may import anything.
 */
const PIPELINE_COMPONENTS = [
  "crawler",
  "planner",
  "executor",
  "generator",
  "automation-runner",
  "healer",
];

const boundaryOverrides = PIPELINE_COMPONENTS.map((component) => ({
  files: [`src/${component}/**/*.ts`],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: PIPELINE_COMPONENTS.filter((other) => other !== component).map((other) => ({
          group: [`**/${other}/**`, `**/${other}`],
          message: `Component '${component}' must not import component '${other}'. Components exchange data only via artifacts (plan §2); shared code belongs in src/core, src/llm, or src/schemas.`,
        })),
      },
    ],
  },
}));

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "templates/**", "coverage/**"],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  ...boundaryOverrides,
  {
    // Config files at the repo root are not part of the typed project service.
    files: ["*.mjs", "*.ts"],
    ignores: ["src/**", "tests/**"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
