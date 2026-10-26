import { defineConfig } from 'vitest/config';
import path from 'node:path';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'ui') } },
  test: {
    environment: 'jsdom',
    include: ['test-ui/*.test.tsx'],
    environmentOptions: { jsdom: { url: 'http://localhost:8787/' } },
  },
});
