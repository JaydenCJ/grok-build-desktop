import { invoke } from "@tauri-apps/api/core";

export interface OverlayState {
  visible: boolean;
  label?: string;
  mode?: "watching" | "controlling";
  action?: string;
}

export interface OverlayCursor {
  x: number;
  y: number;
  label?: string;
  action?: string;
}

/**
 * Show / hide the always-on-top fullscreen transparent overlay window.
 *
 * The overlay is click-through (pointer events ignored at the OS level)
 * and shows a colored border around the entire screen plus an agent
 * cursor sprite — so the user always knows when Grok is controlling
 * something and where its attention is pointed.
 */
export async function setAgentOverlay(state: OverlayState): Promise<void> {
  await invoke("set_agent_overlay", { payload: state });
}

/**
 * Move the agent cursor sprite to a screen-coordinate position.
 * Pass null for cursor to keep the previous position; only x/y trigger
 * a move. The eased CSS transition (cubic-bezier(.2,.8,.2,1), 280ms)
 * makes movement feel like a real cursor gliding.
 */
export async function setAgentCursor(cursor: OverlayCursor): Promise<void> {
  await invoke("set_agent_cursor", { payload: cursor });
}
