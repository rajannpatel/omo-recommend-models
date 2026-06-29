// ESLint v10 flat config
export default [
  {
    files: ["bin/omo-recommend-models", "bin/omo-validate-config", "lib/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        // Node.js globals
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        __dirname: "off", // not available in ESM
        __filename: "off", // not available in ESM
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-empty": ["error", { "allowEmptyCatch": true }],
      "no-duplicate-imports": "error",
      "no-useless-catch": "warn",
    },
  },
];
