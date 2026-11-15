import { defineConfig } from 'vitest/config';

// Reporting tests exercise a real non-UTC local day.
process.env.TZ = 'Asia/Karachi';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'apps/*/src/**/*.test.{ts,tsx}'],
  },
});
