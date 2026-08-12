import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
      'server-only': fileURLToPath(new URL('../../src/test/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['supabase/tests/**/*.integration.test.ts'],
    setupFiles: [fileURLToPath(new URL('./setup-env.ts', import.meta.url))],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
