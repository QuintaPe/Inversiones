// Lint de todo el repositorio (npm run lint). Reglas recomendadas de ESLint y las dos de
// hooks de React; nada de estilo: el formato del código no se discute aquí.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

const unused = ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }];

export default [
  { ignores: ['**/node_modules/**', 'front/dist/**', 'back/data/**', 'test-results/**', 'playwright-report/**', 'e2e/.snapshots/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: { 'no-unused-vars': unused, 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    files: ['back/**/*.{js,mjs}', 'e2e/**/*.js', '*.js', 'front/scripts/**/*.js', 'front/test/**/*.js', 'front/vite.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['front/src/**/*.{js,jsx}', 'shared/**/*.js'],
    languageOptions: { globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  { files: ['front/public/sw.js'], languageOptions: { globals: globals.serviceworker } },
  // Código que se ejecuta dentro de la página en las pruebas de extremo a extremo.
  { files: ['e2e/**/*.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
