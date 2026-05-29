// MCP (Model Context Protocol) integration for the Tools hub.
//
// grok CLI manages MCP servers in ~/.grok/config.toml via `grok mcp add/list/
// remove`. This module wraps those commands and ships a curated catalog of
// popular community servers so the user can one-click install them.
import { invoke } from '@tauri-apps/api/core';

export interface ToolRun {
  ok: boolean;
  command: string;
  cwd: string;
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
  output: string;
  stderr: string;
}

function hasTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function listMcpServers(cwd?: string): Promise<ToolRun | null> {
  if (!hasTauri()) return null;
  return invoke<ToolRun>('list_grok_mcp', { cwd: cwd ?? null });
}

export async function doctorMcp(cwd?: string): Promise<ToolRun | null> {
  if (!hasTauri()) return null;
  return invoke<ToolRun>('doctor_grok_mcp', { cwd: cwd ?? null });
}

export async function addMcpServer(opts: {
  name: string;
  command?: string;
  args?: string[];
  envPairs?: string[];
  url?: string;
  transportType?: string;
}): Promise<ToolRun | null> {
  if (!hasTauri()) return null;
  return invoke<ToolRun>('grok_mcp_add', {
    name: opts.name,
    command: opts.command ?? null,
    args: opts.args ?? null,
    envPairs: opts.envPairs ?? null,
    url: opts.url ?? null,
    transportType: opts.transportType ?? null,
  });
}

export async function removeMcpServer(name: string): Promise<ToolRun | null> {
  if (!hasTauri()) return null;
  return invoke<ToolRun>('grok_mcp_remove', { name });
}

export interface McpCatalogEntry {
  id: string; // grok config server name
  name: string; // display name
  description: string;
  command: string;
  args: string[];
  /** Env vars the user must supply (KEY → human description). */
  requiredEnv?: { key: string; hint: string }[];
  /** A tail arg the user must fill (e.g. a path or connection string). */
  argHint?: string;
  category: 'files' | 'web' | 'dev' | 'data' | 'reasoning' | 'productivity';
  homepage: string;
}

/**
 * Curated catalog of popular community MCP servers (the official reference
 * servers + a few widely-used ones). All are stdio servers launched via npx,
 * so they need Node installed but no global install.
 */
export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read, write, and search files in a directory you allow.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '$HOME'],
    argHint: 'Edit the last arg to the directory you want to expose.',
    category: 'files',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Browse repos, read/write issues & PRs, search code.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requiredEnv: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', hint: 'A GitHub PAT with the scopes you need.' }],
    category: 'dev',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Inspect and operate on a local git repository.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git', '--repository', '$HOME'],
    argHint: 'Point --repository at your repo path.',
    category: 'dev',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Fetch a URL and convert the page to clean markdown.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    category: 'web',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Drive a headless Chrome — navigate, click, screenshot.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    category: 'web',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Run read-only SQL queries against a Postgres database.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
    argHint: 'Replace the connection string with your database URL.',
    category: 'data',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web + local search via the Brave Search API.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    requiredEnv: [{ key: 'BRAVE_API_KEY', hint: 'Free key from brave.com/search/api' }],
    category: 'web',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'A persistent knowledge-graph memory across sessions.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    category: 'reasoning',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning scaffolding.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    category: 'reasoning',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read channels and post messages to a Slack workspace.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    requiredEnv: [
      { key: 'SLACK_BOT_TOKEN', hint: 'xoxb- bot token' },
      { key: 'SLACK_TEAM_ID', hint: 'Your workspace team id' },
    ],
    category: 'productivity',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
];

/** Build the human-readable `grok mcp add …` command for copy/preview. */
export function previewAddCommand(entry: McpCatalogEntry): string {
  // Mirror exactly what the backend runs: each arg as its own `--args=VALUE`
  // (clap rejects a bare `-y`; the `=` form binds it). Keep in sync with
  // grok_mcp_add in src-tauri/src/lib.rs.
  const parts = ['grok', 'mcp', 'add', entry.id, '--command', entry.command, ...entry.args.map((a) => `--args=${a}`)];
  const env = (entry.requiredEnv ?? []).flatMap((e) => ['--env', `${e.key}=…`]);
  return [...parts, ...env].join(' ');
}
