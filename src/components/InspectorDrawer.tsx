// The "Context and tools" inspector drawer: capability tabs (Context /
// Skills / MCP / Agents / Plugins / Hooks / Permissions / Desktop) fed by
// grok inspect output and the managed grok CLI lists. Extracted from App.tsx
// unchanged; hook results arrive as grouped objects.
import { useMemo } from "react";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  FileText,
  FolderGit2,
  GitBranch,
  History,
  Layers3,
  Loader2,
  MoreHorizontal,
  PanelRight,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { ToolRun } from "../lib/grok";
import { DesktopPanel } from "./DesktopPanel";
import type { useGrokRunners } from "../hooks/useGrokRunners";
import type { useModelConfig } from "../hooks/useModelConfig";
import type {
  ActionPolicy,
  DockPosition,
  EffortLevel,
  GrokModelId,
  InspectorTab,
  PermissionMode,
  ReasoningEffort,
} from "../app/types";
import {
  actionPolicies,
  contextFiles,
  effortLevels,
  grokModelPresets,
  grokOptimizationRules,
  inspectorTabs,
  permissionModes,
  reasoningEfforts,
} from "../app/constants";
import {
  formatOutput,
  grokInspectCount,
  grokInspectLine,
  grokInspectSection,
  grokTrust,
} from "../app/format";

export interface InspectorDrawerProps {
  open: boolean;
  onOpenPanel: () => void;
  onClose: () => void;
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
  dockPosition: DockPosition;
  onDockPositionChange: (next: DockPosition) => void;
  runners: ReturnType<typeof useGrokRunners>;
  modelConfig: ReturnType<typeof useModelConfig>;
  actionPolicy: ActionPolicy;
  setActionPolicy: (policy: ActionPolicy) => void;
  history: ToolRun[];
  lastRun: ToolRun | null;
  setLastRun: (run: ToolRun | null) => void;
  clearRunHistory: () => void;
  workspacePath: string;
  onInsertDesktopContext: (text: string) => void;
}

export function InspectorDrawer({
  open,
  onOpenPanel,
  onClose,
  inspectorTab,
  setInspectorTab,
  dockPosition,
  onDockPositionChange,
  runners,
  modelConfig,
  actionPolicy,
  setActionPolicy,
  history,
  lastRun,
  setLastRun,
  clearRunHistory,
  workspacePath,
  onInsertDesktopContext,
}: InspectorDrawerProps) {
  const {
    busyRunner,
    contextBusy,
    grokStatus,
    ecosystemRun,
    modelsRun,
    mcpRun,
    mcpDoctorRun,
    pluginsRun,
    sessionsRun,
    refreshGrokAuthStatus,
    refreshGrokModels,
    refreshGrokEcosystem,
    refreshGrokMcp,
    doctorGrokMcp,
    refreshGrokPlugins,
    refreshGrokSessions,
    startGrokLogin,
  } = runners;
  const {
    modelPreset,
    customModel,
    setCustomModel,
    effortLevel,
    setEffortLevel,
    reasoningEffort,
    setReasoningEffort,
    permissionMode,
    setPermissionMode,
    bestOfN,
    setBestOfN,
    experimentalMemory,
    setExperimentalMemory,
    webSearchEnabled,
    setWebSearchEnabled,
    subagentsEnabled,
    setSubagentsEnabled,
    selfCheck,
    setSelfCheck,
    activeModel,
    activeModelMeta,
    activeReasoningLabel,
    changeModelPreset,
  } = modelConfig;

  const currentPolicy = actionPolicies[actionPolicy];
  const visibleRuns = history.length > 0 ? history : lastRun ? [lastRun] : [];
  const inspectOutput = useMemo(
    () =>
      [ecosystemRun?.output, ecosystemRun?.stderr]
        .filter((value) => value && value.trim())
        .join("\n"),
    [ecosystemRun?.output, ecosystemRun?.stderr],
  );
  const inspectSummary = useMemo(
    () => ({
      skillItems: grokInspectSection(inspectOutput, "Skills", 10),
      agentItems: grokInspectSection(inspectOutput, "Agents", 8),
      pluginItems: grokInspectSection(inspectOutput, "Plugins", 8),
      mcpItems: grokInspectSection(inspectOutput, "MCP Servers", 8),
      hookItems: grokInspectSection(inspectOutput, "Hooks", 8),
      permissionsSource: grokInspectLine(inspectOutput, /Source:\s*([^\n]+)/i, "not inspected"),
    }),
    [inspectOutput],
  );
  const { skillItems, agentItems, pluginItems, mcpItems, hookItems, permissionsSource } = inspectSummary;

  return (
          <details
            className="inspector-drawer"
            onToggle={(event) => {
              if (event.currentTarget.open && !open) onOpenPanel();
              else if (!event.currentTarget.open && open) onClose();
            }}
            open={open}
          >
            <summary>
              <span><PanelRight size={16} /> Context and tools</span>
              <small>
                {grokInspectCount(inspectOutput, "Skills")} skills · {grokInspectCount(inspectOutput, "MCP Servers")} MCP · {grokInspectCount(inspectOutput, "Agents")} agents
              </small>
            </summary>
          <aside className="inspector" aria-label="Grok context">
            <div className="inspector-tabs" role="tablist" aria-label="Grok capability inspector">
              {inspectorTabs.map((tab) => (
                <button
                  aria-pressed={inspectorTab === tab.id}
                  className={inspectorTab === tab.id ? "active" : ""}
                  key={tab.id}
                  onClick={() => setInspectorTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
              <button
                aria-label="Toggle dock position"
                onClick={() => onDockPositionChange(dockPosition === "right" ? "bottom" : "right")}
                title={`Move dock to ${dockPosition === "right" ? "bottom" : "right"}`}
                type="button"
              >
                <PanelRight size={16} />
              </button>
              <button
                aria-label="Close inspector"
                onClick={onClose}
                title="Close (⌘B clears panels)"
                type="button"
              >
                <X size={16} />
              </button>
            </div>

            <div className="inspector-body">
              {inspectorTab === "context" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Model</span>
                      <button disabled={contextBusy !== null} onClick={refreshGrokModels} type="button">
                        {contextBusy === "models" ? <Loader2 className="spin" size={14} /> : <RefreshCcw size={14} />}
                      </button>
                    </div>
                    <div className="model-select">
                      <Sparkles size={16} />
                      <strong>{activeModel}</strong>
                      <ShieldCheck size={15} />
                    </div>
                    <p>{activeModelMeta.detail}. Grok Desktop tunes the CLI with model, agent effort, reasoning effort, permissions, memory, web search, subagents, repo path, and ecosystem context.</p>
                    <div className="engine-grid">
                      <label>
                        <span>Model</span>
                        <select
                          aria-label="Grok model preset"
                          onChange={(event) => changeModelPreset(event.currentTarget.value as GrokModelId)}
                          value={modelPreset}
                        >
                          {(Object.keys(grokModelPresets) as GrokModelId[]).map((model) => (
                            <option key={model} value={model}>
                              {grokModelPresets[model].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Agent effort</span>
                        <select
                          aria-label="Agent effort"
                          onChange={(event) => setEffortLevel(event.currentTarget.value as EffortLevel)}
                          value={effortLevel}
                        >
                          {(Object.keys(effortLevels) as EffortLevel[]).map((effort) => (
                            <option key={effort} value={effort}>
                              {effortLevels[effort].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Reasoning</span>
                        <select
                          aria-label="Reasoning effort"
                          onChange={(event) => setReasoningEffort(event.currentTarget.value as ReasoningEffort)}
                          value={reasoningEffort}
                        >
                          {(Object.keys(reasoningEfforts) as ReasoningEffort[]).map((effort) => (
                            <option key={effort} value={effort}>
                              {reasoningEfforts[effort].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Best-of-N</span>
                        <select
                          aria-label="Best of N"
                          onChange={(event) => setBestOfN(Number(event.currentTarget.value))}
                          value={bestOfN}
                        >
                          {[1, 2, 3, 4, 5].map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Permission</span>
                        <select
                          aria-label="Permission mode"
                          onChange={(event) => setPermissionMode(event.currentTarget.value as PermissionMode)}
                          value={permissionMode}
                        >
                          {(Object.keys(permissionModes) as PermissionMode[]).map((permission) => (
                            <option key={permission} value={permission}>
                              {permissionModes[permission].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {modelPreset === "custom" ? (
                        <label className="engine-wide">
                          <span>Custom ID</span>
                          <input
                            aria-label="Custom Grok model ID"
                            onChange={(event) => setCustomModel(event.currentTarget.value)}
                            placeholder="grok-build"
                            value={customModel}
                          />
                        </label>
                      ) : null}
                    </div>
                    <div className="toggle-row">
                      <label>
                        <input
                          checked={experimentalMemory}
                          onChange={(event) => setExperimentalMemory(event.currentTarget.checked)}
                          type="checkbox"
                        />
                        <span>Memory</span>
                      </label>
                      <label>
                        <input
                          checked={webSearchEnabled}
                          onChange={(event) => setWebSearchEnabled(event.currentTarget.checked)}
                          type="checkbox"
                        />
                        <span>Web</span>
                      </label>
                      <label>
                        <input
                          checked={subagentsEnabled}
                          onChange={(event) => setSubagentsEnabled(event.currentTarget.checked)}
                          type="checkbox"
                        />
                        <span>Subagents</span>
                      </label>
                      <label>
                        <input
                          checked={selfCheck}
                          onChange={(event) => setSelfCheck(event.currentTarget.checked)}
                          type="checkbox"
                        />
                        <span>Check</span>
                      </label>
                    </div>
                    <div className="auth-actions">
                      <button disabled={busyRunner !== null} onClick={() => startGrokLogin(false)} type="button">
                        <Zap size={15} />
                        Connect
                      </button>
                      <button
                        className="secondary-button"
                        disabled={busyRunner !== null || !grokStatus?.installed}
                        onClick={() => startGrokLogin(true)}
                        type="button"
                      >
                        <TerminalSquare size={15} />
                        Device
                      </button>
                      <button className="secondary-button" disabled={busyRunner !== null} onClick={refreshGrokAuthStatus} type="button">
                        <RefreshCcw size={15} />
                        Refresh
                      </button>
                    </div>
                    {modelsRun ? <pre className="mini-output">{formatOutput(modelsRun)}</pre> : null}
                  </section>

                  <section className="inspector-card">
                    <div className="card-head">
                      <span>Repo</span>
                      <code>{grokTrust(inspectOutput)}</code>
                    </div>
                    <div className="repo-readout">
                      <FolderGit2 size={16} />
                      <span>{workspacePath}</span>
                      <MoreHorizontal size={16} />
                    </div>
                    <div className="branch-readout">
                      <GitBranch size={15} />
                      <span>main</span>
                      <small>local workspace</small>
                    </div>
                    <div className="metric-grid">
                      <div>
                        <strong>{grokInspectCount(inspectOutput, "Skills")}</strong>
                        <span>Skills</span>
                      </div>
                      <div>
                        <strong>{grokInspectCount(inspectOutput, "MCP Servers")}</strong>
                        <span>MCP</span>
                      </div>
                      <div>
                        <strong>{grokInspectCount(inspectOutput, "Agents")}</strong>
                        <span>Agents</span>
                      </div>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={contextBusy !== null}
                      onClick={refreshGrokEcosystem}
                      type="button"
                    >
                      {contextBusy === "inspect" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                      Inspect Grok
                    </button>
                  </section>

                  <section className="inspector-card">
                    <div className="card-head">
                      <span>Context Files</span>
                      <code>{contextFiles.length}</code>
                    </div>
                    <div className="file-list">
                      {contextFiles.map((file) => (
                        <span key={file}>
                          <FileText size={14} />
                          {file}
                        </span>
                      ))}
                    </div>
                  </section>
                </>
              ) : null}

              {inspectorTab === "skills" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Skills</span>
                      <code>{grokInspectCount(inspectOutput, "Skills")} discovered</code>
                    </div>
                    <p>Grok inspect reads Claude-compatible skill sources and plugin skills, then Grok Desktop adds the best matches to the coding prompt.</p>
                    <button
                      className="secondary-button"
                      disabled={contextBusy !== null}
                      onClick={refreshGrokEcosystem}
                      type="button"
                    >
                      {contextBusy === "inspect" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                      Refresh Skills
                    </button>
                  </section>
                  <section className="inspector-card">
                    <div className="capability-list">
                      {(skillItems.length ? skillItems : ["Run Inspect Grok to load available skills."]).map((item) => (
                        <span key={item}><Sparkles size={14} /> {item}</span>
                      ))}
                    </div>
                  </section>
                </>
              ) : null}

              {inspectorTab === "mcp" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>MCP</span>
                      <code>{grokInspectCount(inspectOutput, "MCP Servers")} discovered</code>
                    </div>
                    <p>Shows servers discovered by Grok inspect and the active managed list from `grok mcp list`.</p>
                    <div className="auth-actions">
                      <button disabled={busyRunner !== null} onClick={refreshGrokMcp} type="button">
                        {busyRunner === "mcp" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                        List MCP
                      </button>
                      <button className="secondary-button" disabled={busyRunner !== null} onClick={doctorGrokMcp} type="button">
                        {busyRunner === "mcp-doctor" ? <Loader2 className="spin" size={15} /> : <ClipboardCheck size={15} />}
                        Doctor
                      </button>
                    </div>
                  </section>
                  <section className="inspector-card">
                    <div className="card-head">
                      <span>Discovered Servers</span>
                      <code>{mcpItems.length}</code>
                    </div>
                    <div className="capability-list">
                      {(mcpItems.length ? mcpItems : ["No inspect data yet."]).map((item) => (
                        <span key={item}><Wrench size={14} /> {item}</span>
                      ))}
                    </div>
                    {mcpRun ? <pre className="mini-output">{formatOutput(mcpRun)}</pre> : null}
                    {mcpDoctorRun ? <pre className="mini-output">{formatOutput(mcpDoctorRun)}</pre> : null}
                  </section>
                </>
              ) : null}

              {inspectorTab === "agents" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Agents</span>
                      <code>{grokInspectCount(inspectOutput, "Agents")} available</code>
                    </div>
                    <p>Agent metadata helps route repo analysis, review, debugging, browser, and design tasks to the right Grok sub-capability.</p>
                    <button className="secondary-button" disabled={busyRunner !== null} onClick={refreshGrokSessions} type="button">
                      {busyRunner === "sessions" ? <Loader2 className="spin" size={15} /> : <History size={15} />}
                      Sessions
                    </button>
                  </section>
                  <section className="inspector-card">
                    <div className="capability-list">
                      {(agentItems.length ? agentItems : ["Run Inspect Grok to load agents."]).map((item) => (
                        <span key={item}><Bot size={14} /> {item}</span>
                      ))}
                    </div>
                    {sessionsRun ? <pre className="mini-output">{formatOutput(sessionsRun)}</pre> : null}
                  </section>
                </>
              ) : null}

              {inspectorTab === "plugins" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Plugins</span>
                      <code>{grokInspectCount(inspectOutput, "Plugins")} discovered</code>
                    </div>
                    <p>Grok Desktop separates discovered plugins from the active managed list so developers can see what Grok can use versus what it owns.</p>
                    <button className="secondary-button" disabled={busyRunner !== null} onClick={refreshGrokPlugins} type="button">
                      {busyRunner === "plugins" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                      List Plugins
                    </button>
                  </section>
                  <section className="inspector-card">
                    <div className="capability-list">
                      {(pluginItems.length ? pluginItems : ["Run Inspect Grok to load plugins."]).map((item) => (
                        <span key={item}><Layers3 size={14} /> {item}</span>
                      ))}
                    </div>
                    {pluginsRun ? <pre className="mini-output">{formatOutput(pluginsRun)}</pre> : null}
                  </section>
                </>
              ) : null}

              {inspectorTab === "hooks" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Hooks</span>
                      <code>{grokInspectCount(inspectOutput, "Hooks")} loaded</code>
                    </div>
                    <p>Hooks are surfaced as first-class context because they change how Grok behaves before and after tool work.</p>
                  </section>
                  <section className="inspector-card">
                    <div className="capability-list">
                      {(hookItems.length ? hookItems : ["Run Inspect Grok to load hooks."]).map((item) => (
                        <span key={item}><Zap size={14} /> {item}</span>
                      ))}
                    </div>
                  </section>
                </>
              ) : null}

              {inspectorTab === "permissions" ? (
                <>
                  <section className="inspector-card hero-card">
                    <div className="card-head">
                      <span>Approvals</span>
                      <code>{permissionsSource}</code>
                    </div>
                    <div className="approval-select">
                      <ShieldCheck size={16} />
                      <select
                        aria-label="Approval policy"
                        onChange={(event) => setActionPolicy(event.currentTarget.value as ActionPolicy)}
                        value={actionPolicy}
                      >
                        {(Object.keys(actionPolicies) as ActionPolicy[]).map((policy) => (
                          <option key={policy} value={policy}>
                            {actionPolicies[policy].label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p>{currentPolicy.detail}</p>
                  </section>
                  <section className="inspector-card">
                    <div className="card-head">
                      <span>Grok Optimization</span>
                      <code>{effortLevels[effortLevel].label}</code>
                    </div>
                    <div className="safety-list">
                      {grokOptimizationRules.map((rule) => (
                        <span key={rule}><ShieldCheck size={14} /> {rule}</span>
                      ))}
                      <span><ShieldCheck size={14} /> Model: {activeModel}</span>
                      <span><ShieldCheck size={14} /> Permission mode: {permissionModes[permissionMode].label}</span>
                      <span><ShieldCheck size={14} /> Reasoning: {activeReasoningLabel}</span>
                      <span><ShieldCheck size={14} /> Web search: {webSearchEnabled ? "enabled" : "disabled"}</span>
                      <span><ShieldCheck size={14} /> Subagents: {subagentsEnabled ? "enabled" : "disabled"}</span>
                      <span><ShieldCheck size={14} /> Self-check: {selfCheck ? "enabled" : "off"}</span>
                    </div>
                  </section>
                  <section className="inspector-card">
                    <div className="card-head">
                      <span>Command History</span>
                      <button
                        aria-label="Clear run history"
                        disabled={history.length === 0 && !lastRun}
                        onClick={clearRunHistory}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="command-history">
                      {visibleRuns.length > 0 ? (
                        visibleRuns.slice(0, 5).map((run, index) => (
                          <button key={`${run.command}-${index}`} onClick={() => setLastRun(run)} type="button">
                            {run.ok ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
                            <span>{run.command}</span>
                            <small>{run.exit_code ?? "n/a"}</small>
                          </button>
                        ))
                      ) : (
                        <p>No runs yet.</p>
                      )}
                    </div>
                  </section>
                </>
              ) : null}

              {inspectorTab === "desktop" ? (
                <DesktopPanel onInsertContext={onInsertDesktopContext} />
              ) : null}
            </div>
          </aside>
          </details>
  );
}
