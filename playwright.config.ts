import { defineConfig, devices } from '@playwright/test'

/**
 * 本地：自动构建并启动 vite preview 作为被测页面。
 * 容器验收（docker compose run verify）：通过 BASE_URL 指向 page 服务，不再自起服务。
 */
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Docker 中 /dev/shm 默认较小，避免标签页崩溃（Playwright 官方容器建议）
        launchOptions: { args: ['--disable-dev-shm-usage'] },
      },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
})
