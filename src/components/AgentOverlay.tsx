import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface OverlayState {
  visible: boolean;
  /** Short label for the cursor sprite. */
  label: string;
  /** Screen-coordinate cursor position. */
  cursor: { x: number; y: number } | null;
  /** "watching" | "controlling" — affects border color/intensity. */
  mode: "watching" | "controlling";
  /** Current action text shown near the cursor. */
  action: string;
}

const INITIAL: OverlayState = {
  visible: false,
  label: "Grok",
  cursor: null,
  mode: "controlling",
  action: "",
};

export function AgentOverlay() {
  const [state, setState] = useState<OverlayState>(INITIAL);

  useEffect(() => {
    const unsubPromises: Promise<() => void>[] = [];

    unsubPromises.push(
      listen<Partial<OverlayState>>("grok-desktop://overlay-state", (e) => {
        setState((prev) => ({ ...prev, ...e.payload }));
      }),
    );
    unsubPromises.push(
      listen<{ x: number; y: number; label?: string; action?: string }>(
        "grok-desktop://overlay-cursor",
        (e) => {
          setState((prev) => ({
            ...prev,
            cursor: { x: e.payload.x, y: e.payload.y },
            label: e.payload.label ?? prev.label,
            action: e.payload.action ?? prev.action,
          }));
        },
      ),
    );

    return () => {
      unsubPromises.forEach((p) =>
        p
          .then((unsub) => unsub())
          .catch(() => {
            /* listener not attached, nothing to clean up */
          }),
      );
    };
  }, []);

  if (!state.visible) return null;

  const isControlling = state.mode === "controlling";

  return (
    <>
      <style>{`
        .agent-overlay-frame {
          position: fixed;
          inset: 0;
          pointer-events: none;
          border: ${isControlling ? "5px" : "3px"} solid
            ${isControlling ? "rgba(255, 122, 69, 0.92)" : "rgba(96, 165, 250, 0.78)"};
          box-shadow:
            inset 0 0 0 1px ${isControlling ? "rgba(255, 122, 69, 0.45)" : "rgba(96, 165, 250, 0.30)"},
            inset 0 0 120px ${isControlling ? "rgba(255, 122, 69, 0.18)" : "rgba(96, 165, 250, 0.10)"};
          animation: agent-overlay-pulse 2.4s ease-in-out infinite;
        }
        @keyframes agent-overlay-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: ${isControlling ? "0.78" : "0.85"}; }
        }
        .agent-overlay-tag {
          position: fixed;
          top: 14px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(11, 14, 19, 0.92);
          backdrop-filter: blur(20px);
          border: 1px solid ${isControlling ? "rgba(255, 122, 69, 0.55)" : "rgba(96, 165, 250, 0.55)"};
          border-radius: 999px;
          color: #e8ecf4;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.3px;
          padding: 6px 14px;
          pointer-events: none;
          text-transform: uppercase;
          box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
        }
        .agent-overlay-tag .dot {
          color: ${isControlling ? "#ff7a45" : "#60a5fa"};
          margin-right: 6px;
          animation: agent-overlay-dot 1.2s ease-in-out infinite;
        }
        @keyframes agent-overlay-dot {
          0%, 100% { opacity: 0.4; }
          50%      { opacity: 1; }
        }
        .agent-cursor {
          position: fixed;
          left: 0;
          top: 0;
          pointer-events: none;
          transition: transform 280ms cubic-bezier(.2,.8,.2,1);
          z-index: 999999;
        }
        .agent-cursor-trail {
          position: absolute;
          left: -16px;
          top: -14px;
          width: 38px;
          height: 38px;
          border-radius: 999px;
          background: ${isControlling ? "rgba(255, 122, 69, 0.22)" : "rgba(96, 165, 250, 0.22)"};
          border: 1px solid ${isControlling ? "rgba(255, 122, 69, 0.40)" : "rgba(96, 165, 250, 0.40)"};
          animation: agent-cursor-pulse 1.6s ease-in-out infinite;
        }
        @keyframes agent-cursor-pulse {
          0%   { transform: scale(0.85); opacity: 0.95; }
          70%  { transform: scale(1.25); opacity: 0; }
          100% { transform: scale(1.25); opacity: 0; }
        }
        .agent-cursor-pointer {
          width: 30px;
          height: 34px;
          background: linear-gradient(145deg, ${isControlling ? "#ff9466" : "#82b8ff"}, #11151c);
          clip-path: polygon(0 0, 0 28px, 9px 21px, 15px 34px, 22px 31px, 16px 18px, 29px 18px);
          filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.55));
        }
        .agent-cursor-label {
          position: absolute;
          top: 26px;
          left: 28px;
          background: rgba(11, 14, 19, 0.96);
          backdrop-filter: blur(14px);
          border: 1px solid ${isControlling ? "rgba(255, 122, 69, 0.55)" : "rgba(96, 165, 250, 0.55)"};
          border-radius: 8px;
          color: #e8ecf4;
          font-size: 11px;
          font-weight: 700;
          padding: 5px 9px;
          white-space: nowrap;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
        }
        .agent-cursor-action {
          color: ${isControlling ? "#ff9466" : "#82b8ff"};
          font-weight: 500;
          font-size: 10px;
          margin-top: 2px;
        }
      `}</style>

      <div className="agent-overlay-frame" />

      <div className="agent-overlay-tag">
        <span className="dot">●</span>
        Grok {state.mode}
        {state.action ? <span>&nbsp;· {state.action}</span> : null}
      </div>

      {state.cursor ? (
        <div
          className="agent-cursor"
          style={{
            transform: `translate3d(${state.cursor.x}px, ${state.cursor.y}px, 0)`,
          }}
        >
          <div className="agent-cursor-trail" />
          <div className="agent-cursor-pointer" />
          <div className="agent-cursor-label">
            <div>{state.label}</div>
            {state.action ? (
              <div className="agent-cursor-action">{state.action}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
