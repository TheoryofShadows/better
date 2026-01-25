import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/__tests__/**',
        'src/cli.ts'
      ],
      thresholds: {
        lines: 50,
        functions: 60,
        branches: 50,
        statements: 50
      }
    },
    testTimeout: 30000
  }
});
