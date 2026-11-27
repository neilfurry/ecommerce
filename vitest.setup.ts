import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// The first render of a lazily loaded route can take more than the default 1 s on a cold CI
// runner (seen in the Admin Console catalog and sales tests); waiting longer never slows a
// passing test, it only stops it from failing on a slow start.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no ResizeObserver; Radix checkboxes and tabs measure themselves with it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
