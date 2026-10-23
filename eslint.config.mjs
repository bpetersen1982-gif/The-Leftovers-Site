import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-console": ["error", { allow: ["error"] }],
    },
  },
  {
    // The bootstrap CLI talks to a human in a terminal.
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    ignores: [".next/**", "node_modules/**", "src/generated/**", "test-results/**", "playwright-report/**", "next-env.d.ts"],
  },
];

export default config;
