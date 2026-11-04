// Playwright config for the Sound Along UI functional suite.
// Runs against a private Vite dev server on port 5199 (so it never collides with
// the 5173 server you use by hand), or against SA_UI_URL if you set it.
import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.resolve(here, '../../../frontend')
const PORT = Number(process.env.SA_UI_PORT || 5199)
const external = process.env.SA_UI_URL

export default defineConfig({
  testDir: './tests',
  outputDir: './out/test-results',
  fullyParallel: true,
  retries: 1,            // a test that passes only on retry is reported as flaky and gets a P3 ticket
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: 'out/results.json' }],
    ['html', { outputFolder: 'out/report', open: 'never' }],
  ],
  use: {
    baseURL: external || `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Headless Chromium, real media codecs; autoplay allowed so Polly audio can start without a gesture.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: external ? undefined : {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: frontend,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
