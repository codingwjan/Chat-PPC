import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  {
    ignores: ["legacy-cra/**", "node_modules/**", ".next/**", "coverage/**"],
  },
  ...nextVitals,
  ...nextTs,
];

export default config;
