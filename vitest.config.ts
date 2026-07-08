import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      // Measure the whole frontend surface, not just files imported by tests,
      // so the coverage number is honest about untested modules.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        // Runs inside a Web Worker; not loadable in the jsdom test bundle.
        'src/lib/markdown.worker.ts',
      ],
      reporter: ['text', 'text-summary'],
    },
  },
});
