/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: { es2020: true, node: true, browser: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  ignorePatterns: ['node_modules/', 'dist/', 'main.js', '.tmp*/', '.auth-check/', '.DS_Store'],
  rules: {}
};
