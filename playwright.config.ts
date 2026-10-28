import { defineConfig } from '@playwright/test';

/**
 * Tests d'interface sur l'EXPORT DE PRODUCTION (même code que celui mis en ligne), relié au serveur local
 * (vraie base PostgreSQL PGlite, mêmes migrations et règles de sécurité). L'assistant y parle à un FAUX serveur
 * Anthropic réservé aux tests (e2e/mock-anthropic.mjs). Navigateur : Microsoft Edge installé sur le poste.
 */
process.env.E2E_RUN ??= Date.now().toString(36);
const API_PORT = 54399;
const MOCK_PORT = 54398;
const PUSH_PORT = 54397;
const WEB_PORT = 4319;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'reports/playwright',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'reports/e2e-results.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    channel: process.env.PW_CHANNEL ?? 'msedge',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'telephone', testIgnore: /desktop\.spec/, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'ordinateur', testMatch: /desktop\.spec/, dependencies: ['telephone'], use: { viewport: { width: 1366, height: 860 } } },
  ],
  webServer: [
    {
      command: `node e2e/mock-anthropic.mjs ${MOCK_PORT}`,
      url: `http://127.0.0.1:${MOCK_PORT}/v1/models`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 30_000,
      // Le faux serveur répond 401 sans clé : Playwright attend juste qu'il réponde.
      stdout: 'pipe',
    },
    {
      // Faux service de notifications push (Apple, Google…) : déchiffre ce qu'il reçoit, pour les vérifications.
      command: `node --disable-warning=ExperimentalWarning e2e/mock-push.ts ${PUSH_PORT}`,
      url: `http://127.0.0.1:${PUSH_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
    },
    {
      command: `node --disable-warning=ExperimentalWarning server/local/main.ts --reset --data .local/e2e --port ${API_PORT} --confirm-email-test`,
      url: `http://127.0.0.1:${API_PORT}/rest/v1/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ANTHROPIC_API_KEY: 'sk-ant-e2e-test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`, PUSH_TEST_ORIGIN: `http://127.0.0.1:${PUSH_PORT}` },
    },
    {
      command: `npx vite build --outDir reports/e2e-dist --emptyOutDir && node e2e/write-config.mjs reports/e2e-dist ${API_PORT} && npx vite preview --outDir reports/e2e-dist --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
