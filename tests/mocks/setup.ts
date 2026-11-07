/**
 * tests/mocks/setup.ts
 * Vitest setup file executed before all test files.
 */
import { beforeAll, beforeEach } from 'vitest';
import { installMockChrome, resetMockChrome } from './chrome';

beforeAll(() => {
  installMockChrome();
});

beforeEach(() => {
  resetMockChrome();
});
