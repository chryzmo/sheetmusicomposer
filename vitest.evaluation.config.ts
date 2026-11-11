import { defineConfig } from 'vitest/config';

// Explicit opt-in only: the ordinary unit/fixture suite never scores evaluation
// recordings. The runner verifies frozen source/data hashes before classifying.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/evaluation/**/*.test.ts'],
  },
});
