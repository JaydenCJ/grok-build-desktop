import { useEffect, useRef, useState } from "react";
import { useActiveRun } from "../hooks/useActiveRun";
import { setAgentOverlay } from "../lib/overlay";

/**
 * Headless component that watches the active-run state and toggles the
 * OS-level overlay window via the `set_agent_overlay` Tauri command.
 *
 * No UI — render this once near the App root and it does its thing.
 */
export function AgentOverlayDriver() {
  const active = useActiveRun();
  const lastVisibleRef = useRef<boolean>(false);
  // Last payload actually sent over IPC. Every stream token produces a fresh
  // `active` snapshot, so without payload-level dedupe this effect fired a
  // Tauri invoke (an OS-window manipulation) dozens of times per second.
  const lastSentRef = useRef<string>('');
  const [enabled, setEnabled] = useState(true);

  // Respect a user toggle persisted in localStorage so anyone irritated
  // by the overlay can switch it off without code changes.
  useEffect(() => {
    const stored = window.localStorage.getItem("grok-desktop-overlay-enabled");
    if (stored === "0") setEnabled(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Force-hide if user disabled it.
      if (lastVisibleRef.current) {
        lastVisibleRef.current = false;
        lastSentRef.current = '';
        setAgentOverlay({ visible: false }).catch(() => {});
      }
      return;
    }

    const shouldShow = Boolean(active && active.state === "running");
    if (shouldShow === lastVisibleRef.current && !active) return;
    lastVisibleRef.current = shouldShow;

    const stateText = active
      ? active.lastEventType === "thought"
        ? "thinking…"
        : active.lastEventType === "text"
          ? "writing…"
          : "running…"
      : "";

    // Skip the invoke when neither visibility nor the action label changed.
    const payloadKey = `${shouldShow}|${stateText}`;
    if (payloadKey === lastSentRef.current) return;
    lastSentRef.current = payloadKey;

    setAgentOverlay({
      visible: shouldShow,
      mode: "controlling",
      label: "Grok",
      action: stateText,
    }).catch((e) => {
      // Tauri command may fail if overlay window isn't registered (e.g. browser preview).
      // Silent — log once and continue.
      if (!(window as unknown as { __overlayWarned?: boolean }).__overlayWarned) {
        (window as unknown as { __overlayWarned?: boolean }).__overlayWarned = true;
        console.warn("[grok-desktop] agent overlay disabled:", e);
      }
    });
  }, [active, enabled]);

  return null;
}
