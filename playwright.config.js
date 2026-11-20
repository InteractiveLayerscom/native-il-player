import { defineConfig } from '@playwright/test';

const port = 4194;

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:' + port,
    channel: process.env.IL_PLAYER_BROWSER_CHANNEL || undefined,
  },
  webServer: {
    command: 'node test/server.mjs ' + port,
    url: 'http://127.0.0.1:' + port,
  },
});
