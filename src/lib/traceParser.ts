// Heuristic parser for grok streaming-json events that AREN'T thought/text/end.
// Grok CLI emits tool / subagent / plan events but its protocol is undocumented
// and changes. Rather than couple to one schema, we sniff for common shapes
// (Anthropic-style, OpenAI-style, raw bash/file events) and produce a unified
// TraceEvent. Events we can't classify are returned as kind:'other' so the UI
// can still surface them in a debug pane.
//
// We trust ZERO field structures — every read is `?? string`.

export type TraceKind = 'tool' | 'subagent' | 'task' | 'other';
export type TraceStatus = 'running' | 'done' | 'error';

export interface TraceEvent {
  /** Stable within a run; lets us merge "start" + "end" into a single card. */
  key: string;
  kind: TraceKind;
  label: string;
  status: TraceStatus;
  startedAt: number;
  endedAt: number | null;
  /** Short snippet for the card body — usually input args or a result preview. */
  detail?: string;
  /** Raw JSON for the debug drawer (developer mode). */
  raw?: unknown;
}

/** Result of parsing a single raw event. */
export type TraceParseResult =
  | { kind: 'create'; event: TraceEvent }
  | { kind: 'finish'; key: string; status: TraceStatus; detail?: string }
  | { kind: 'ignore' };

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function readField(obj: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = obj[n];
    const s = asString(v);
    if (s !== undefined && s !== '') return s;
  }
  return undefined;
}

function readObj(obj: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const v = obj[name];
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

function shortenJson(value: unknown, max = 140): string {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  } catch {
    return '';
  }
}

/**
 * Classify a raw streaming-json event line into a TraceEvent.
 * @param raw  The parsed JSON value emitted by grok (any shape).
 * @returns    A directive: create a new trace card, finish an existing one,
 *             or ignore the event entirely.
 */
export function classifyEvent(raw: unknown): TraceParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'ignore' };
  const obj = raw as Record<string, unknown>;
  const type = readField(obj, 'type', 'event', 'kind') ?? '';
  // Known non-trace types — already rendered as message body.
  if (type === 'thought' || type === 'text' || type === 'end') return { kind: 'ignore' };

  const lower = type.toLowerCase();
  const isError =
    lower.endsWith('_error') ||
    lower.endsWith('_fail') ||
    lower.endsWith('_failed') ||
    lower === 'error' ||
    lower === 'tool_error';
  const isEnd =
    isError || // errors always terminate
    lower.endsWith('_end') ||
    lower.endsWith('_complete') ||
    lower.endsWith('_done') ||
    lower.endsWith('_result') ||
    lower === 'tool_result';
  const isStart =
    lower.endsWith('_start') ||
    lower.endsWith('_begin') ||
    lower === 'tool_use' ||
    lower === 'tool_call';

  // Subagent / sub-task events
  const isSubagent =
    lower.includes('subagent') || lower.includes('sub_agent') || lower.includes('agent_');
  // Plan / task events
  const isTask = lower.includes('task') || lower.includes('plan');

  // Try to extract a stable key so START and END pair up.
  const id =
    readField(obj, 'id', 'tool_use_id', 'tool_id', 'call_id', 'invocation_id', 'request_id') ??
    `${type}-${asString(obj.name) ?? asString(obj.tool_name) ?? Math.random().toString(36).slice(2)}`;
  const key = `trace:${id}`;

  // Pick a human-readable label.
  const toolName =
    readField(obj, 'name', 'tool', 'tool_name', 'function_name', 'subagent', 'agent', 'plan') ??
    type;
  const inputSummary = (() => {
    const inputObj =
      readObj(obj, 'input') ??
      readObj(obj, 'arguments') ??
      readObj(obj, 'args') ??
      readObj(obj, 'params');
    if (inputObj) return shortenJson(inputObj);
    const inputStr = readField(obj, 'input', 'arguments', 'args', 'params', 'prompt');
    if (inputStr) return shortenJson(inputStr);
    return undefined;
  })();
  const outputSummary = (() => {
    const out =
      readObj(obj, 'output') ?? readObj(obj, 'result') ?? readObj(obj, 'response');
    if (out) return shortenJson(out);
    const outStr = readField(obj, 'output', 'result', 'response', 'text', 'content');
    if (outStr) return shortenJson(outStr);
    return undefined;
  })();
  const errStr = readField(obj, 'error', 'message', 'stderr');

  // Decide kind for new cards.
  const kind: TraceKind = isSubagent
    ? 'subagent'
    : isTask
      ? 'task'
      : lower.includes('tool') || readField(obj, 'tool_name', 'tool', 'function_name')
        ? 'tool'
        : 'other';

  if (isEnd) {
    return {
      kind: 'finish',
      key,
      status: isError ? 'error' : 'done',
      detail: errStr ?? outputSummary ?? inputSummary,
    };
  }

  // Treat anything that wasn't an end as the start of a card.
  if (isStart || isSubagent || isTask || kind === 'tool') {
    return {
      kind: 'create',
      event: {
        key,
        kind,
        label: toolName,
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        detail: inputSummary,
        raw,
      },
    };
  }

  return { kind: 'ignore' };
}
