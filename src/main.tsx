import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ensureStreamListenersAttached } from "./lib/grok";

const STORAGE_KEY_PREFIX = "grok-desktop-";

// Wire up Tauri event listeners for the run queue + stream events.
// Fire-and-forget; failures leave the store empty rather than blocking startup.
void ensureStreamListenersAttached().catch((e) => {
  console.warn("[grok-desktop] failed to attach Tauri stream listeners", e);
});

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
