import { defineConfig } from 'vitest/config';

// Separate config for the measurement benches under scripts/ — they simulate
// whole streaming runs with real markdown parses, so they'd slow down and add
// timing noise to the regular `npm run test:unit` suite.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['scripts/bench-*.ts'],
  },
});
