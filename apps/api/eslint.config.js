import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(js.configs.recommended, tseslint.configs.recommended, {files:["src/**/*.ts"],languageOptions:{globals:{console:"readonly",process:"readonly",Buffer:"readonly",crypto:"readonly",setInterval:"readonly",clearInterval:"readonly"}},rules:{"no-unused-vars":"off"}});
