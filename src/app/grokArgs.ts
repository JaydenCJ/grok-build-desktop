// Pure builders for the grok CLI invocation. Extracted from App.tsx —
// behavior must match the composer's submit path exactly.
import type {
  ActionPolicy,
  EffortLevel,
  Mode,
  PermissionMode,
  ReasoningEffort,
} from "./types";

export interface GrokRunConfig {
  mode: Mode;
  activeModel: string;
  effortLevel: EffortLevel;
  reasoningEffort: ReasoningEffort;
  actionPolicy: ActionPolicy;
  permissionMode: PermissionMode;
  bestOfN: number;
  experimentalMemory: boolean;
  webSearchEnabled: boolean;
  subagentsEnabled: boolean;
  selfCheck: boolean;
  codingCwd: string;
  /** True when the conversation already has messages (follow-up turn). */
  continueConversation: boolean;
}

// The user turn is EXACTLY what the user typed. grok-build already ships a
// strong coding system prompt, so durable behavioural guidance is appended at
// the system level via `--rules` (see buildGrokRules) instead of bolting a
// preamble onto every user turn. That keeps the model on-task, makes the
// chat bubble an exact mirror of the request, and avoids fighting
// grok-build's own prompt. Operational settings (effort/reasoning/best-of-n/
// permission/web/subagents) ride as real CLI flags — never echoed as prose.

// Durable, system-level guidance for grok-build, passed via `--rules` (grok
// appends it to the agent's own system prompt — verified the model honours
// it). Kept TIGHT: only high-value additions beyond grok-build's defaults.
// We deliberately do NOT report grok's own ecosystem back to it (it discovers
// its 90+ skills / MCP servers itself via `grok inspect`; the old preamble
// hard-said "0 skills" before inspect had run, which was actively wrong).
export function buildGrokRules(config: Pick<GrokRunConfig, "mode" | "actionPolicy">): string | null {
  if (config.mode !== "coding") return null;
  const rules = [
    "Operate as a senior engineer: high signal, minimal ceremony.",
    "Before editing, quickly map the repo — entry points, likely files, build/test commands, risk boundaries.",
    "Prefer exact file paths, exact commands, and concrete diffs over prose.",
    "Keep edits narrow and make verification easy: give one command to verify each change.",
    "If the request is ambiguous, make the safest useful assumption and state it in one line.",
  ];
  // The only action-policy intent not already enforced by a CLI flag:
  // "review" has no grok permission flag, so the read-only contract lives here.
  if (config.actionPolicy === "review") {
    rules.push(
      "Stay read-only: analyze and propose changes, but do not edit files or run mutating commands.",
    );
  }
  return rules.join("\n");
}

export function buildGrokArgs(config: GrokRunConfig): string[] {
  const args: string[] = ["--no-alt-screen", "--output-format", "streaming-json"];
  if (config.activeModel) args.push("--model", config.activeModel);
  if (config.effortLevel) args.push("--effort", config.effortLevel);
  if (config.reasoningEffort && config.reasoningEffort !== "off") {
    // grok's --reasoning-effort accepts: none|minimal|low|medium|high|xhigh.
    // The UI's "Max" is NOT a valid grok value — sending it makes grok exit
    // with code 2 ("invalid reasoning effort: max") and reply NOTHING (this
    // was the "grok 压根不回我" bug). Map Max → xhigh (grok's real maximum).
    const r = config.reasoningEffort === "max" ? "xhigh" : config.reasoningEffort;
    args.push("--reasoning-effort", r);
  }
  // Action policy → REAL grok permission behavior.
  //   review   → read-only contract (carried by --rules); no permission flag
  //   patch    → respect the advanced Settings permission-mode override (incl.
  //              "plan" for power users), else grok's default approvals
  //   autopilot→ --always-approve  (auto-approves EVERY tool call — risky)
  if (config.actionPolicy === "autopilot") {
    args.push("--always-approve");
  } else if (config.permissionMode && config.permissionMode !== "default") {
    args.push("--permission-mode", config.permissionMode);
  }
  if (config.bestOfN > 1) args.push("--best-of-n", String(config.bestOfN));
  // Behavioural guidance at the system-prompt level (grok-native), instead of
  // a preamble in the user turn. Coding mode only; chat stays freeform.
  const rules = buildGrokRules(config);
  if (rules) args.push("--rules", rules);
  if (config.experimentalMemory) args.push("--experimental-memory");
  if (!config.webSearchEnabled) args.push("--disable-web-search");
  // grok rejects `--no-subagents` together with `--best-of-n` ("cannot be
  // used with") — best-of-n fans work out to subagents. So only disable
  // subagents when we're NOT running best-of-n. (Another grok-exit-2 cause.)
  if (!config.subagentsEnabled && config.bestOfN <= 1) args.push("--no-subagents");
  if (config.selfCheck) args.push("--check");
  args.push("--max-turns", "12");
  if (config.mode === "coding" && config.codingCwd.trim()) {
    args.push("--cwd", config.codingCwd.trim());
  }
  // Auto-continue the current cwd's session when the conversation already
  // has messages (the user is following up, not starting fresh). This is
  // what Claude Desktop / Codex do — there's only ever one composer, and
  // the second message in a conversation implicitly continues the first.
  if (config.continueConversation) {
    args.push("-c");
  }
  return args;
}
