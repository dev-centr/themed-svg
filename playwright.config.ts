import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './browser',
  reporter: 'line',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
