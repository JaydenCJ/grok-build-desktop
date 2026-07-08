// Shared vitest setup: jest-dom matchers, DOM cleanup, Tauri IPC mock reset,
// and a clean localStorage between tests so persisted-state hooks can't leak
// state across cases.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearMocks } from '@tauri-apps/api/mocks';

afterEach(() => {
  cleanup();
  clearMocks();
  window.localStorage.clear();
});
