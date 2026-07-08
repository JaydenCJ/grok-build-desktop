import React from "react";
import ReactDOM from "react-dom/client";
// Bundled variable fonts (family names "Geist Variable" and
// "JetBrains Mono Variable") — replaces the Google Fonts <link> so the app
// works offline and the CSP can drop remote style/font origins.
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import App from "./App";
import { I18nProvider } from "./i18n";

const STORAGE_KEY_PREFIX = "grok-desktop-";

// Tauri event listeners for the run queue + stream events are attached from
// App's mount effect (with bounded retry + a visible notice on failure) — see
// ensureStreamListenersAttached in lib/grok.ts.

// Suppress the WebView's native context menu (Reload / Inspect Element /
// Services) — it looks unfinished in a shipped desktop app. Keep it on real
// editable fields so right-click → Paste still works in the composer/inputs.
window.addEventListener(
  "contextmenu",
  (e) => {
    const t = e.target as HTMLElement | null;
    const editable =
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable);
    if (!editable) e.preventDefault();
  },
  { capture: true },
);

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[grok-desktop] render error:", error, info);
  }

  handleResetLocalStorage = () => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(STORAGE_KEY_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => window.localStorage.removeItem(k));
    } catch (error) {
      console.error("[grok-desktop] reset failed:", error);
    }
    window.location.reload();
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          alignItems: "center",
          background: "#0d0f11",
          color: "#f4f4f5",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Inter, system-ui, -apple-system, sans-serif",
          gap: 16,
          height: "100vh",
          justifyContent: "center",
          padding: 32,
          textAlign: "center",
        }}
      >
        <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>
          Grok Desktop hit a rendering error
        </h2>
        <p style={{ color: "#a1a1aa", margin: 0, maxWidth: 480 }}>
          The app crashed during startup. This is usually due to corrupted local
          settings from a previous version. You can safely reset session data
          and reload — no Grok CLI state is touched.
        </p>
        <pre
          style={{
            background: "#15181c",
            border: "1px solid #24282e",
            borderRadius: 6,
            color: "#ef4444",
            fontSize: "0.78rem",
            margin: 0,
            maxHeight: 160,
            maxWidth: 560,
            overflow: "auto",
            padding: 12,
            textAlign: "left",
            whiteSpace: "pre-wrap",
          }}
        >
          {String(this.state.error?.stack ?? this.state.error)}
        </pre>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={this.handleReload}
            style={{
              background: "transparent",
              border: "1px solid #24282e",
              borderRadius: 6,
              color: "#f4f4f5",
              cursor: "pointer",
              fontSize: "0.85rem",
              padding: "8px 14px",
            }}
            type="button"
          >
            Reload
          </button>
          <button
            onClick={this.handleResetLocalStorage}
            style={{
              background: "#f5f5f5",
              border: "1px solid #f5f5f5",
              borderRadius: 6,
              color: "#0d0f11",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 700,
              padding: "8px 14px",
            }}
            type="button"
          >
            Reset session and reload
          </button>
        </div>
      </div>
    );
  }
}

// Use a module-global cached root so HMR re-execution of this entry doesn't
// re-create the root on the same container (which logs a noisy React warning
// in dev). The cache is keyed by the container element so reloads stay clean.
const ROOT_KEY = "__GROK_DESKTOP_ROOT__" as const;
type RootCache = { [k: string]: ReturnType<typeof ReactDOM.createRoot> };
const rootCache: RootCache =
  (window as unknown as { [ROOT_KEY]?: RootCache })[ROOT_KEY] ?? {};
(window as unknown as { [ROOT_KEY]?: RootCache })[ROOT_KEY] = rootCache;

const container = document.getElementById("root") as HTMLElement;
const root = rootCache.main ?? ReactDOM.createRoot(container);
rootCache.main = root;

root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
