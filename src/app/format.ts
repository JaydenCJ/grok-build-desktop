// Pure formatting/parsing helpers shared by App and its hooks.
import type { ToolRun } from "../lib/grok";
import type { ToolStatus } from "./types";

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

export function parseAvailableModels(output: string): string[] {
  if (!output.trim()) return [];
  const lines = output.split("\n");
  const start = lines.findIndex((line) => /available models/i.test(line));
  if (start < 0) return [];
  const models = new Set<string>();
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*[*\-•]\s*([\w./:@-]+)/);
    if (!match) {
      if (models.size > 0) break;
      continue;
    }
    models.add(match[1]);
  }
  return Array.from(models);
}

export function timeLabel(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function nativeUnavailable(command: string): ToolRun {
  return {
    ok: false,
    command,
    cwd: "",
    exit_code: null,
    duration_ms: 0,
    timed_out: false,
    output: "",
    stderr:
      "Native commands are available in the Tauri desktop window. Run npm run tauri:dev.",
  };
}

export function formatOutput(run: ToolRun | null, terminalOutput = "") {
  if (terminalOutput.trim()) return terminalOutput;
  if (!run) return "No run yet.";
  const output = run.output.trim();
  const stderr = run.stderr.trim();

  if (!output && !stderr) return "Command finished without output.";
  if (run.ok && output) return output;
  if (!output) return stderr;
  if (!stderr) return output;
  return `${output}\n\nstderr:\n${stderr}`;
}

export function terminalClass(line: string) {
  if (line.startsWith("[err]")) return "terminal-line terminal-error";
  if (line.startsWith("[sys]")) return "terminal-line terminal-system";
  if (
    line.includes("```") ||
    line.includes("diff --git") ||
    line.includes("@@") ||
    /^\[out\]\s{2,}/.test(line) ||
    /^\[out\]\s[+-]/.test(line)
  ) {
    return "terminal-line terminal-code";
  }
  return "terminal-line";
}

export function terminalText(line: string) {
  return line.replace(/^\[(out|err|sys)\]\s?/, "");
}

export function terminalPrefix(line: string) {
  const match = line.match(/^\[(out|err|sys)\]/);
  return match?.[1] ?? "out";
}

export function statusTone(status?: ToolStatus) {
  if (!status) return "idle";
  return status.installed ? "ready" : "missing";
}

export function grokInspectCount(output: string, label: string) {
  const match = output.match(new RegExp(`${label} \\((\\d+)\\)`));
  return match?.[1] ?? "0";
}

export function grokInspectSection(output: string, label: string, limit = 8) {
  const lines = output.split("\n");
  const headings = [
    "Skills",
    "Agents",
    "Plugins",
    "Marketplaces",
    "MCP Servers",
    "Hooks",
    "Config Sources",
    "Permissions",
  ];
  const start = lines.findIndex((line) => line.trim().startsWith(`${label} (`));
  if (start < 0) return [];

  const items: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      if (items.length > 0) break;
      continue;
    }

    if (headings.some((heading) => trimmed.startsWith(`${heading} (`))) break;

    const item = trimmed
      .replace(/^[-•]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/\s+/g, " ");
    if (item) items.push(item);
    if (items.length >= limit) break;
  }

  return items;
}

export function grokInspectLine(output: string, pattern: RegExp, fallback = "unknown") {
  return output.match(pattern)?.[1]?.trim() ?? fallback;
}

export function grokTrust(output: string) {
  const match = output.match(/Project trusted:\s*(yes|no)/i);
  return match?.[1] ?? "unknown";
}
