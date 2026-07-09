import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    // Anchor discovery to this project's src tree; the default glob also
    // walks nested checkouts under the repo root (e.g. linked worktrees)
    // and would run their copies of every test file.
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      // Measure the whole frontend surface, not just files imported by tests,
      // so the coverage number is honest about untested modules.
      include: ['src/**/*.{ts,tsx}'],
      // Keep exclusions to genuine non-code: tests, test setup, and type-only
      // declarations. Everything else in src/ counts — including files no test
      // imports (they are statically analyzed and reported at 0%), so the
      // number cannot be inflated by simply not testing a module.
      exclude: ['src/**/__tests__/**', 'src/test/**', 'src/vite-env.d.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
});
