import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { files: ["**/*.{js,mjs,cjs}"], plugins: { js }, extends: ["js/recommended"] },
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
  { files: ["**/*.{js,mjs,cjs}"], languageOptions: { globals: {...globals.node, ...globals.browser} } },
  { 
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { 
      globals: {
        "consale": "readonly",
        "__DEV__": "readonly",
        "__dirpath": "readonly",
      }
    },
    rules: {
      "no-empty": "off",
      "no-unused-vars": "off",
      "no-control-regex": "off",
      "no-unreachable": "off",
      "no-extra-boolean-cast": "off",
    }
  },
]);
