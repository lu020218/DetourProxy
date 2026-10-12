import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default to a Node environment for the pure Shared Core logic.
    // DOM-dependent tests (Popup UI) opt into jsdom via a per-file
    // `// @vitest-environment jsdom` comment.
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
