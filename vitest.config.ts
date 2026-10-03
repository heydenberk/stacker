import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['builder/**/*.test.ts', 'web/**/*.test.ts'] },
});
