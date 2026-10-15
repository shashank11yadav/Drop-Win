import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'fairness', root: 'packages/fairness', include: ['test/**/*.test.ts'] } },
      { test: { name: 'contract', root: 'packages/contract', include: ['test/**/*.test.ts'] } },
      { test: { name: 'ledger', root: 'packages/ledger', include: ['test/**/*.test.ts'] } },
      { test: { name: 'api', root: 'apps/api', include: ['test/**/*.test.ts'] } },
      { test: { name: 'web', root: 'apps/web', include: ['test/**/*.test.ts'] } },
    ],
  },
});
