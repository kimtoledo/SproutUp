import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default env is node (pure logic + client libs). Component render tests opt
    // into jsdom with a `// @vitest-environment jsdom` docblock at the top of
    // the file.
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
  },
});
