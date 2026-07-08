// Shared Tauri runtime detection. Tauri 2 injects __TAURI_INTERNALS__ on
// window; in a plain browser (vite dev / tests) it is absent, so callers can
// no-op or fall back gracefully. This used to be copy-pasted in six modules.
export function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
