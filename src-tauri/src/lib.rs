use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
struct ToolStatus {
    id: String,
    label: String,
    command: String,
    installed: bool,
    detail: String,
}

#[derive(Deserialize, Serialize, Clone)]
struct ToolRun {
    ok: bool,
    command: String,
    cwd: String,
    exit_code: Option<i32>,
    duration_ms: u128,
    timed_out: bool,
    output: String,
    stderr: String,
}

#[derive(Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct SessionState {
    mode: Option<String>,
    drafts: serde_json::Value,
    coding_cwd: Option<String>,
    shell_command: Option<String>,
    action_policy: Option<String>,
    coding_workflow: Option<String>,
    chrome_extension_id: Option<String>,
    last_run: Option<ToolRun>,
    history: Vec<ToolRun>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GrokAuthStatus {
    installed: bool,
    authenticated: bool,
    api_key_present: bool,
    cached_login_present: bool,
    config_present: bool,
    version: String,
    detail: String,
    login_command: String,
    device_login_command: String,
    install_command: String,
    npm_install_command: String,
    auth_path: String,
    config_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GrokStreamEvent {
    run_id: String,
    stream: String,
    line: String,
    done: bool,
    ok: Option<bool>,
    exit_code: Option<i32>,
    duration_ms: Option<u128>,
    cwd: String,
    command: String,
}

#[derive(Deserialize, Serialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
struct ChromeHeading {
    level: String,
    text: String,
}

#[derive(Deserialize, Serialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
struct ChromeSnapshot {
    title: String,
    url: String,
    language: String,
    canonical: String,
    description: String,
    selected_text: String,
    headings: Vec<ChromeHeading>,
    text_sample: String,
    updated_at: Option<u64>,
}

#[derive(Deserialize, Serialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
struct ChromeTabState {
    id: i64,
    title: String,
    url: String,
    status: String,
    task: String,
    updated_at: Option<u64>,
    snapshot: Option<ChromeSnapshot>,
}

fn default_true() -> bool {
    true
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(default, rename_all = "camelCase")]
struct ChromeBridgeSettings {
    #[serde(default = "default_true")]
    focus_guard: bool,
    #[serde(default = "default_true")]
    visible_motion: bool,
    #[serde(default = "default_true")]
    controlled_tabs_only: bool,
}

impl Default for ChromeBridgeSettings {
    fn default() -> Self {
        Self {
            focus_guard: true,
            visible_motion: true,
            controlled_tabs_only: true,
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct ChromeBridgeFile {
    connected: bool,
    extension_id: Option<String>,
    updated_at: Option<u64>,
    last_error: Option<String>,
    settings: ChromeBridgeSettings,
    tabs: Vec<ChromeTabState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChromeBridgeState {
    ok: bool,
    connected: bool,
    host_name: String,
    extension_id: Option<String>,
    updated_at: Option<u64>,
    state_path: String,
    tabs: Vec<ChromeTabState>,
    settings: ChromeBridgeSettings,
    last_error: Option<String>,
}

fn truncate_text(value: String) -> String {
    const MAX_CHARS: usize = 12_000;
    if value.chars().count() <= MAX_CHARS {
        return value;
    }

    let trimmed: String = value.chars().take(MAX_CHARS).collect();
    format!("{trimmed}\n\n[output truncated]")
}

fn strip_ansi_codes(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for code_ch in chars.by_ref() {
                    if ('@'..='~').contains(&code_ch) {
                        break;
                    }
                }
                continue;
            }
        }
        output.push(ch);
    }

    output
}

fn command_line(program: &str, args: &[String]) -> String {
    let mut redact_next = false;
    let suffix = args
        .iter()
        .map(|arg| {
            if redact_next {
                redact_next = false;
                return "<prompt>".to_string();
            }

            if arg == "-p" || arg == "--single" {
                redact_next = true;
            }

            if arg.starts_with("--single=") {
                return "--single=<prompt>".to_string();
            }

            if arg.contains(' ') {
                format!("\"{}\"", arg.replace('"', "\\\""))
            } else {
                arg.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    if suffix.is_empty() {
        program.to_string()
    } else {
        format!("{program} {suffix}")
    }
}

fn command_path() -> String {
    let home = env::var("HOME").unwrap_or_else(|_| "~".to_string());
    let fallback = format!(
        "{home}/.local/bin:{home}/.grok/bin:{home}/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    );
    match env::var("PATH") {
        Ok(path) if !path.trim().is_empty() => format!("{fallback}:{path}"),
        _ => fallback,
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn applescript_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn version_status(id: &str, label: &str, program: &str, args: &[&str]) -> ToolStatus {
    let output = Command::new(program)
        .args(args)
        .env("PATH", command_path())
        .output();
    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
            ToolStatus {
                id: id.to_string(),
                label: label.to_string(),
                command: program.to_string(),
                installed: result.status.success(),
                detail: if stdout.is_empty() { stderr } else { stdout },
            }
        }
        Err(error) => ToolStatus {
            id: id.to_string(),
            label: label.to_string(),
            command: program.to_string(),
            installed: false,
            detail: error.to_string(),
        },
    }
}

fn command_timeout_secs(default_secs: u64) -> u64 {
    env::var("GROK_DESKTOP_COMMAND_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default_secs)
}

fn split_template_args(template: &str, prompt: &str, mode: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for ch in template.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }

        match ch {
            '\\' => escaped = true,
            '"' | '\'' if quote == Some(ch) => quote = None,
            '"' | '\'' if quote.is_none() => quote = Some(ch),
            ch if ch.is_whitespace() && quote.is_none() => {
                if !current.is_empty() {
                    args.push(current.replace("{prompt}", prompt).replace("{mode}", mode));
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }

    if !current.is_empty() {
        args.push(current.replace("{prompt}", prompt).replace("{mode}", mode));
    }

    args
}

fn run_external_command(
    program: &str,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    timeout_secs: u64,
) -> ToolRun {
    let display_command = command_line(program, &args);
    let cwd = cwd.unwrap_or_else(project_root);
    let start = Instant::now();
    let spawn_result = Command::new(program)
        .args(&args)
        .current_dir(&cwd)
        .env("PATH", command_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match spawn_result {
        Ok(child) => child,
        Err(error) => {
            return ToolRun {
                ok: false,
                command: display_command,
                cwd: cwd.to_string_lossy().to_string(),
                exit_code: None,
                duration_ms: start.elapsed().as_millis(),
                timed_out: false,
                output: String::new(),
                stderr: format!("{error}. Check that `{program}` is installed and on PATH."),
            }
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let output = Arc::new(Mutex::new(String::new()));
    let error_output = Arc::new(Mutex::new(String::new()));
    let mut reader_threads = Vec::new();

    if let Some(stdout) = stdout {
        let output = Arc::clone(&output);
        reader_threads.push(thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(mut buffer) = output.lock() {
                    buffer.push_str(&strip_ansi_codes(&line));
                    buffer.push('\n');
                }
            }
        }));
    }

    if let Some(stderr) = stderr {
        let error_output = Arc::clone(&error_output);
        reader_threads.push(thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut buffer) = error_output.lock() {
                    buffer.push_str(&strip_ansi_codes(&line));
                    buffer.push('\n');
                }
            }
        }));
    }

    let timeout = Duration::from_secs(timeout_secs);
    let mut timed_out = false;

    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() >= timeout => {
                timed_out = true;
                let _ = child.kill();
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(80)),
            Err(error) => {
                return ToolRun {
                    ok: false,
                    command: display_command,
                    cwd: cwd.to_string_lossy().to_string(),
                    exit_code: None,
                    duration_ms: start.elapsed().as_millis(),
                    timed_out: false,
                    output: String::new(),
                    stderr: error.to_string(),
                }
            }
        }
    }

    let wait_result = child.wait();
    for handle in reader_threads {
        let _ = handle.join();
    }

    match wait_result {
        Ok(status) => {
            let mut stderr = error_output
                .lock()
                .map(|buffer| buffer.clone())
                .unwrap_or_default();
            if timed_out {
                let timeout_note = format!("Command timed out after {timeout_secs}s.");
                stderr = if stderr.trim().is_empty() {
                    timeout_note
                } else {
                    format!("{stderr}\n{timeout_note}")
                };
            }

            ToolRun {
                ok: status.success() && !timed_out,
                command: display_command,
                cwd: cwd.to_string_lossy().to_string(),
                exit_code: status.code(),
                duration_ms: start.elapsed().as_millis(),
                timed_out,
                output: truncate_text(
                    output
                        .lock()
                        .map(|buffer| buffer.clone())
                        .unwrap_or_default(),
                ),
                stderr: truncate_text(stderr),
            }
        }
        Err(error) => ToolRun {
            ok: false,
            command: display_command,
            cwd: cwd.to_string_lossy().to_string(),
            exit_code: None,
            duration_ms: start.elapsed().as_millis(),
            timed_out,
            output: String::new(),
            stderr: error.to_string(),
        },
    }
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn bundled_resource_root() -> Option<PathBuf> {
    let executable = env::current_exe().ok()?;
    let contents_dir = executable.parent()?.parent()?;
    let resources_dir = contents_dir.join("Resources");
    if resources_dir.join("scripts").exists() {
        Some(resources_dir)
    } else if resources_dir.join("_up_").join("scripts").exists() {
        Some(resources_dir.join("_up_"))
    } else {
        None
    }
}

fn runtime_resource_root() -> PathBuf {
    if let Some(resource_root) = bundled_resource_root() {
        return resource_root;
    }

    let source_root = project_root();
    if source_root.join("scripts").exists() {
        source_root
    } else {
        bundled_resource_root().unwrap_or(source_root)
    }
}

fn absorbed_output_root() -> PathBuf {
    if bundled_resource_root().is_some() {
        return app_support_dir().join("absorbed");
    }

    let source_root = project_root();
    if source_root.join("scripts").exists() {
        source_root.join("absorbed")
    } else {
        app_support_dir().join("absorbed")
    }
}

fn script_path(name: &str) -> PathBuf {
    runtime_resource_root().join("scripts").join(name)
}

fn app_support_dir() -> PathBuf {
    env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Library")
        .join("Application Support")
        .join("Grok Desktop")
}

fn chrome_bridge_state_path() -> PathBuf {
    app_support_dir().join("chrome_state.json")
}

fn session_state_path() -> PathBuf {
    app_support_dir().join("session_state.json")
}

fn grok_home_dir() -> PathBuf {
    env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".grok")
}

#[tauri::command]
fn load_session_state() -> Result<Option<SessionState>, String> {
    let path = session_state_path();
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<SessionState>(&raw)
            .map(Some)
            .map_err(|error| format!("Could not parse session state: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read session state: {error}")),
    }
}

#[tauri::command]
fn save_session_state(state: SessionState) -> Result<(), String> {
    let path = session_state_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create session directory: {error}"))?;
    }
    let raw = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("Could not serialize session state: {error}"))?;
    fs::write(&path, raw).map_err(|error| format!("Could not save session state: {error}"))
}

fn path_has_entries(path: &PathBuf) -> bool {
    fs::read_dir(path)
        .ok()
        .and_then(|mut entries| entries.next())
        .is_some()
}

fn mode_context(mode: &str) -> &'static str {
    match mode {
        "coding" => {
            "Grok Desktop Grok Code Mode: act as a senior programming desktop assistant for professional engineers. Optimize for repository understanding, precise edits, terminal verification, and concise engineering judgment."
        }
        _ => {
            "Grok Desktop Grok Chat Mode: answer clearly, keep practical context, and hand off to Coding Mode when the task touches a repository, terminal, or code change."
        }
    }
}

fn grok_prompt(prompt: &str, mode: &str, cwd: &PathBuf) -> String {
    format!(
        r#"{context}

You are running inside Grok Desktop, a Grok-first desktop programming environment inspired by the best parts of Claude Desktop, but optimized for the official Grok Build CLI.

Workspace contract:
- Current working directory: {cwd}
- Treat the selected directory as the active project unless the user says otherwise.
- Read relevant files before recommending or applying code changes.
- Prefer small, reviewable changes over broad rewrites.
- Use terminal commands for verification when useful, and report the exact commands.
- Never run destructive commands or irreversible migrations unless the user explicitly asked for them.
- If credentials, private files, or risky operations appear, pause and explain the risk.

Engineering behavior:
- For analysis tasks, produce a high-signal technical readout with file paths, risks, and next actions.
- For implementation tasks, state the intended change, keep edits focused, and include verification.
- For debugging tasks, distinguish evidence, hypothesis, root cause, fix, and verification.
- For reviews, prioritize correctness, regressions, tests, security, and maintainability.

Response format:
1. Summary
2. Files / Evidence
3. Changes or Recommendation
4. Verification commands
5. Next step

User task:
{prompt}"#,
        context = mode_context(mode),
        cwd = cwd.to_string_lossy()
    )
}

fn normalized_effort(effort: Option<String>) -> String {
    match effort
        .unwrap_or_else(|| "high".to_string())
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "minimal" => "minimal".to_string(),
        "low" => "low".to_string(),
        "medium" => "medium".to_string(),
        "high" => "high".to_string(),
        "xhigh" => "xhigh".to_string(),
        "max" => "max".to_string(),
        _ => "high".to_string(),
    }
}

fn normalized_reasoning_effort(reasoning_effort: Option<String>) -> Option<String> {
    match reasoning_effort
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "" | "off" | "none" => None,
        "minimal" => Some("minimal".to_string()),
        "low" => Some("low".to_string()),
        "medium" => Some("medium".to_string()),
        "high" => Some("high".to_string()),
        "xhigh" => Some("xhigh".to_string()),
        "max" => Some("max".to_string()),
        _ => None,
    }
}

fn normalized_model(model: Option<String>) -> String {
    let value = model.unwrap_or_else(|| "grok-build".to_string());
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        "grok-build".to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalized_best_of_n(best_of_n: Option<u8>) -> Option<u8> {
    best_of_n.and_then(|value| match value {
        2..=5 => Some(value),
        _ => None,
    })
}

fn normalized_permission_mode(permission_mode: Option<String>) -> Option<String> {
    let value = permission_mode?;
    match value.trim() {
        "" | "default" => None,
        "acceptEdits" => Some("acceptEdits".to_string()),
        "auto" => Some("auto".to_string()),
        "dontAsk" => Some("dontAsk".to_string()),
        "plan" => Some("plan".to_string()),
        "bypassPermissions" => Some("bypassPermissions".to_string()),
        _ => None,
    }
}

fn grok_args(
    prompt: &str,
    mode: &str,
    cwd: &PathBuf,
    model: Option<String>,
    effort: Option<String>,
    reasoning_effort: Option<String>,
    permission_mode: Option<String>,
    best_of_n: Option<u8>,
    experimental_memory: bool,
    web_search_enabled: bool,
    subagents_enabled: bool,
    self_check: bool,
) -> Vec<String> {
    let prepared_prompt = grok_prompt(prompt, mode, cwd);
    if let Ok(template) = env::var("GROK_DESKTOP_GROK_ARGS") {
        return split_template_args(&template, &prepared_prompt, mode);
    }

    let model = normalized_model(model);
    let effort = normalized_effort(effort);
    let mut args = vec![
        "--no-alt-screen".to_string(),
        "--model".to_string(),
        model,
        "--effort".to_string(),
        effort,
    ];

    if let Some(permission_mode) = normalized_permission_mode(permission_mode) {
        args.push("--permission-mode".to_string());
        args.push(permission_mode);
    }

    if self_check
        || matches!(
            env::var("GROK_DESKTOP_GROK_CHECK").as_deref(),
            Ok("1" | "true" | "yes")
        )
    {
        args.push("--check".to_string());
    }

    if let Some(reasoning_effort) = normalized_reasoning_effort(reasoning_effort) {
        args.push("--reasoning-effort".to_string());
        args.push(reasoning_effort);
    }

    if let Some(best_of_n) = normalized_best_of_n(best_of_n) {
        args.push("--best-of-n".to_string());
        args.push(best_of_n.to_string());
    }

    if experimental_memory {
        args.push("--experimental-memory".to_string());
    }

    if !web_search_enabled {
        args.push("--disable-web-search".to_string());
    }

    if !subagents_enabled {
        args.push("--no-subagents".to_string());
    }

    args.push("-p".to_string());
    args.push(prepared_prompt);
    args.push("--output-format".to_string());
    args.push("plain".to_string());
    args
}

fn normalized_cwd(cwd: Option<String>) -> PathBuf {
    cwd.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    })
    .unwrap_or_else(project_root)
}

fn collect_grok_auth_status() -> GrokAuthStatus {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    let version_result = Command::new(&program)
        .arg("--version")
        .env("PATH", command_path())
        .output();
    let installed = version_result
        .as_ref()
        .map(|result| result.status.success())
        .unwrap_or(false);
    let version = version_result
        .as_ref()
        .map(|result| {
            let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
            if stdout.is_empty() {
                stderr
            } else {
                stdout
            }
        })
        .unwrap_or_default();

    let grok_home = grok_home_dir();
    let auth_dir_path = grok_home.join("auth");
    let auth_json_path = grok_home.join("auth.json");
    let config_path = grok_home.join("config.toml");
    let api_key_present = env::var("XAI_API_KEY")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
        || env::var("GROK_CODE_XAI_API_KEY")
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
    let cached_login_present =
        (auth_dir_path.exists() && path_has_entries(&auth_dir_path)) || auth_json_path.exists();
    let config_present = config_path.exists();
    let authenticated = api_key_present || cached_login_present;
    let detail = if !installed {
        "Grok CLI is not installed or not on PATH.".to_string()
    } else if authenticated {
        if api_key_present {
            "Authenticated with an API key environment variable.".to_string()
        } else {
            "A cached Grok CLI login was found.".to_string()
        }
    } else {
        "Run `grok login`, `grok login --device-auth`, or set XAI_API_KEY.".to_string()
    };

    GrokAuthStatus {
        installed,
        authenticated,
        api_key_present,
        cached_login_present,
        config_present,
        version,
        detail,
        login_command: format!("{program} login"),
        device_login_command: format!("{program} login --device-auth"),
        install_command: "curl -fsSL https://x.ai/cli/install.sh | bash".to_string(),
        npm_install_command: "npm install -g @xai-official/grok".to_string(),
        auth_path: auth_json_path.to_string_lossy().to_string(),
        config_path: config_path.to_string_lossy().to_string(),
    }
}

#[tauri::command]
async fn get_grok_auth_status() -> GrokAuthStatus {
    tauri::async_runtime::spawn_blocking(collect_grok_auth_status)
        .await
        .unwrap_or_else(|error| GrokAuthStatus {
            installed: false,
            authenticated: false,
            api_key_present: false,
            cached_login_present: false,
            config_present: false,
            version: String::new(),
            detail: error.to_string(),
            login_command: "grok login".to_string(),
            device_login_command: "grok login --device-auth".to_string(),
            install_command: "curl -fsSL https://x.ai/cli/install.sh | bash".to_string(),
            npm_install_command: "npm install -g @xai-official/grok".to_string(),
            auth_path: String::new(),
            config_path: String::new(),
        })
}

#[tauri::command]
fn start_grok_login(device_auth: bool, cwd: Option<String>) -> ToolRun {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    let status = collect_grok_auth_status();
    let cwd = normalized_cwd(cwd);
    let login_args = if device_auth {
        "login --device-auth"
    } else {
        "login"
    };
    let program_for_shell = shell_quote(&program);
    let terminal_command = format!(
        "cd {cwd}; clear; echo {title}; echo; if ! command -v {program} >/dev/null 2>&1; then echo {missing}; echo {installer}; read -r -p {install_prompt}; eval {install_script}; export PATH=\"$HOME/.local/bin:$HOME/.grok/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"; hash -r; fi; echo; if command -v {program} >/dev/null 2>&1; then {program} {login_args}; else echo {still_missing}; fi; echo; echo {done}; read -n 1 -s -r -p {close_prompt}",
        cwd = shell_quote(&cwd.to_string_lossy()),
        title = shell_quote("Grok Desktop Grok setup"),
        program = program_for_shell,
        missing = shell_quote("Grok Build CLI was not found on PATH."),
        installer = shell_quote("Official installer: curl -fsSL https://x.ai/cli/install.sh | bash"),
        install_prompt = shell_quote(
            "Press Return to install the official Grok CLI, or Control-C to cancel: "
        ),
        install_script = shell_quote(&status.install_command),
        login_args = login_args,
        still_missing = shell_quote(
            "Grok still was not found. Restart Terminal or set GROK_DESKTOP_GROK_CMD to the Grok executable path."
        ),
        done = shell_quote("Return to Grok Desktop and click Refresh Grok Status."),
        close_prompt = shell_quote("Press any key to close this window."),
    );
    let script = format!(
        "tell application \"Terminal\"\nactivate\ndo script {}\nend tell",
        applescript_quote(&terminal_command)
    );

    run_external_command(
        "osascript",
        vec!["-e".to_string(), script],
        None,
        command_timeout_secs(15),
    )
}

fn emit_grok_event(app: &AppHandle, event: GrokStreamEvent) {
    let _ = app.emit("grok-desktop://grok-stream", event);
}

fn grok_missing_error(
    program: &str,
    command: &str,
    cwd: &PathBuf,
    error: std::io::Error,
) -> ToolRun {
    ToolRun {
        ok: false,
        command: command.to_string(),
        cwd: cwd.to_string_lossy().to_string(),
        exit_code: None,
        duration_ms: 0,
        timed_out: false,
        output: String::new(),
        stderr: format!(
            "{error}. Grok Build CLI was not launched. Install the official CLI, run its login/API key setup, or set GROK_DESKTOP_GROK_CMD to the executable path. Tried `{program}`."
        ),
    }
}

fn run_external_command_streaming(
    app: AppHandle,
    run_id: String,
    program: &str,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    timeout_secs: u64,
) -> ToolRun {
    let display_command = command_line(program, &args);
    let cwd = cwd.unwrap_or_else(project_root);
    let cwd_string = cwd.to_string_lossy().to_string();
    let start = Instant::now();

    emit_grok_event(
        &app,
        GrokStreamEvent {
            run_id: run_id.clone(),
            stream: "system".to_string(),
            line: format!("Starting {display_command}"),
            done: false,
            ok: None,
            exit_code: None,
            duration_ms: Some(0),
            cwd: cwd_string.clone(),
            command: display_command.clone(),
        },
    );

    if !cwd.exists() || !cwd.is_dir() {
        let message =
            format!("Working directory does not exist or is not a directory: {cwd_string}");
        emit_grok_event(
            &app,
            GrokStreamEvent {
                run_id,
                stream: "system".to_string(),
                line: message.clone(),
                done: true,
                ok: Some(false),
                exit_code: None,
                duration_ms: Some(start.elapsed().as_millis()),
                cwd: cwd_string.clone(),
                command: display_command.clone(),
            },
        );
        return ToolRun {
            ok: false,
            command: display_command,
            cwd: cwd_string,
            exit_code: None,
            duration_ms: start.elapsed().as_millis(),
            timed_out: false,
            output: String::new(),
            stderr: message,
        };
    }

    let spawn_result = Command::new(program)
        .args(&args)
        .current_dir(&cwd)
        .env("PATH", command_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match spawn_result {
        Ok(child) => child,
        Err(error) => {
            let run = grok_missing_error(program, &display_command, &cwd, error);
            emit_grok_event(
                &app,
                GrokStreamEvent {
                    run_id,
                    stream: "system".to_string(),
                    line: run.stderr.clone(),
                    done: true,
                    ok: Some(false),
                    exit_code: None,
                    duration_ms: Some(run.duration_ms),
                    cwd: run.cwd.clone(),
                    command: run.command.clone(),
                },
            );
            return run;
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let output = Arc::new(Mutex::new(String::new()));
    let error_output = Arc::new(Mutex::new(String::new()));
    let mut stream_threads = Vec::new();

    if let Some(stdout) = stdout {
        let app = app.clone();
        let run_id = run_id.clone();
        let cwd = cwd_string.clone();
        let command = display_command.clone();
        let output = Arc::clone(&output);
        stream_threads.push(thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let line = strip_ansi_codes(&line);
                if let Ok(mut buffer) = output.lock() {
                    buffer.push_str(&line);
                    buffer.push('\n');
                }
                emit_grok_event(
                    &app,
                    GrokStreamEvent {
                        run_id: run_id.clone(),
                        stream: "stdout".to_string(),
                        line,
                        done: false,
                        ok: None,
                        exit_code: None,
                        duration_ms: None,
                        cwd: cwd.clone(),
                        command: command.clone(),
                    },
                );
            }
        }));
    }

    if let Some(stderr) = stderr {
        let app = app.clone();
        let run_id = run_id.clone();
        let cwd = cwd_string.clone();
        let command = display_command.clone();
        let error_output = Arc::clone(&error_output);
        stream_threads.push(thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let line = strip_ansi_codes(&line);
                if let Ok(mut buffer) = error_output.lock() {
                    buffer.push_str(&line);
                    buffer.push('\n');
                }
                emit_grok_event(
                    &app,
                    GrokStreamEvent {
                        run_id: run_id.clone(),
                        stream: "stderr".to_string(),
                        line,
                        done: false,
                        ok: None,
                        exit_code: None,
                        duration_ms: None,
                        cwd: cwd.clone(),
                        command: command.clone(),
                    },
                );
            }
        }));
    }

    let timeout = Duration::from_secs(timeout_secs);
    let mut timed_out = false;

    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() >= timeout => {
                timed_out = true;
                let _ = child.kill();
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(120)),
            Err(error) => {
                let stderr = error.to_string();
                emit_grok_event(
                    &app,
                    GrokStreamEvent {
                        run_id,
                        stream: "system".to_string(),
                        line: stderr.clone(),
                        done: true,
                        ok: Some(false),
                        exit_code: None,
                        duration_ms: Some(start.elapsed().as_millis()),
                        cwd: cwd_string.clone(),
                        command: display_command.clone(),
                    },
                );
                return ToolRun {
                    ok: false,
                    command: display_command,
                    cwd: cwd_string,
                    exit_code: None,
                    duration_ms: start.elapsed().as_millis(),
                    timed_out: false,
                    output: String::new(),
                    stderr,
                };
            }
        }
    }

    let wait_result = child.wait();
    for handle in stream_threads {
        let _ = handle.join();
    }

    let exit_code = wait_result.as_ref().ok().and_then(|status| status.code());
    let mut stderr = error_output
        .lock()
        .map(|buffer| buffer.clone())
        .unwrap_or_default();
    if timed_out {
        let timeout_note = format!("Command timed out after {timeout_secs}s.");
        stderr = if stderr.trim().is_empty() {
            timeout_note
        } else {
            format!("{stderr}\n{timeout_note}")
        };
    }

    let ok = wait_result
        .as_ref()
        .map(|status| status.success())
        .unwrap_or(false)
        && !timed_out;
    let duration_ms = start.elapsed().as_millis();
    let final_line = if ok {
        "Grok command finished.".to_string()
    } else if timed_out {
        format!("Grok command timed out after {timeout_secs}s.")
    } else {
        format!("Grok command exited with {:?}.", exit_code)
    };

    emit_grok_event(
        &app,
        GrokStreamEvent {
            run_id,
            stream: "system".to_string(),
            line: final_line,
            done: true,
            ok: Some(ok),
            exit_code,
            duration_ms: Some(duration_ms),
            cwd: cwd_string.clone(),
            command: display_command.clone(),
        },
    );

    ToolRun {
        ok,
        command: display_command,
        cwd: cwd_string,
        exit_code,
        duration_ms,
        timed_out,
        output: truncate_text(
            output
                .lock()
                .map(|buffer| buffer.clone())
                .unwrap_or_default(),
        ),
        stderr: truncate_text(stderr),
    }
}

fn collect_tool_statuses() -> Vec<ToolStatus> {
    let grok = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    vec![version_status("grok", "Grok Build", &grok, &["--version"])]
}

#[tauri::command]
async fn get_tool_statuses() -> Vec<ToolStatus> {
    tauri::async_runtime::spawn_blocking(collect_tool_statuses)
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn run_grok_task(prompt: String, mode: String, cwd: Option<String>) -> ToolRun {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    let cwd = normalized_cwd(cwd);
    run_external_command(
        &program,
        grok_args(&prompt, &mode, &cwd, None, None, None, None, None, false, true, true, false),
        Some(cwd),
        command_timeout_secs(240),
    )
}

#[tauri::command]
fn run_grok_streaming_task(
    app: AppHandle,
    prompt: String,
    mode: String,
    cwd: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    reasoning_effort: Option<String>,
    permission_mode: Option<String>,
    best_of_n: Option<u8>,
    experimental_memory: bool,
    web_search_enabled: bool,
    subagents_enabled: bool,
    self_check: bool,
    run_id: String,
) -> ToolRun {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    let cwd = normalized_cwd(cwd);
    run_external_command_streaming(
        app,
        run_id,
        &program,
        grok_args(
            &prompt,
            &mode,
            &cwd,
            model,
            effort,
            reasoning_effort,
            permission_mode,
            best_of_n,
            experimental_memory,
            web_search_enabled,
            subagents_enabled,
            self_check,
        ),
        Some(cwd),
        command_timeout_secs(600),
    )
}

#[tauri::command]
fn run_shell_command(command: String, cwd: Option<String>) -> ToolRun {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return ToolRun {
            ok: false,
            command: "zsh -lc".to_string(),
            cwd: normalized_cwd(cwd).to_string_lossy().to_string(),
            exit_code: None,
            duration_ms: 0,
            timed_out: false,
            output: String::new(),
            stderr: "Enter a shell command first.".to_string(),
        };
    }

    let cwd = normalized_cwd(cwd);
    run_external_command(
        "zsh",
        vec!["-lc".to_string(), trimmed.to_string()],
        Some(cwd),
        command_timeout_secs(600),
    )
}

#[tauri::command]
async fn inspect_grok_environment(cwd: Option<String>) -> ToolRun {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    let cwd = normalized_cwd(cwd);
    match tauri::async_runtime::spawn_blocking(move || {
        run_external_command(
            &program,
            vec!["inspect".to_string()],
            Some(cwd),
            command_timeout_secs(15),
        )
    })
    .await
    {
        Ok(run) => run,
        Err(error) => ToolRun {
            ok: false,
            command: "grok inspect".to_string(),
            cwd: String::new(),
            exit_code: None,
            duration_ms: 0,
            timed_out: false,
            output: String::new(),
            stderr: error.to_string(),
        },
    }
}

#[tauri::command]
async fn list_grok_models() -> ToolRun {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    match tauri::async_runtime::spawn_blocking(move || {
        run_external_command(
            &program,
            vec!["models".to_string()],
            None,
            command_timeout_secs(8),
        )
    })
    .await
    {
        Ok(run) => run,
        Err(error) => ToolRun {
            ok: false,
            command: "grok models".to_string(),
            cwd: String::new(),
            exit_code: None,
            duration_ms: 0,
            timed_out: false,
            output: String::new(),
            stderr: error.to_string(),
        },
    }
}

#[tauri::command]
async fn list_grok_mcp(cwd: Option<String>) -> ToolRun {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    let cwd = normalized_cwd(cwd);
    match tauri::async_runtime::spawn_blocking(move || {
        run_external_command(
            &program,
            vec!["mcp".to_string(), "list".to_string()],
            Some(cwd),
            command_timeout_secs(10),
        )
    })
    .await
    {
        Ok(run) => run,
        Err(error) => ToolRun {
            ok: false,
            command: "grok mcp list".to_string(),
            cwd: String::new(),
            exit_code: None,
            duration_ms: 0,
            timed_out: false,
            output: String::new(),
            stderr: error.to_string(),
        },
    }
}

#[tauri::command]
async fn doctor_grok_mcp(cwd: Option<String>) -> ToolRun {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    let cwd = normalized_cwd(cwd);
    match tauri::async_runtime::spawn_blocking(move || {
        run_external_command(
            &program,
            vec!["mcp".to_string(), "doctor".to_string()],
            Some(cwd),
            command_timeout_secs(30),
        )
    })
    .await
    {
        Ok(run) => run,
        Err(error) => ToolRun {
            ok: false,
            command: "grok mcp doctor".to_string(),
            cwd: String::new(),
            exit_code: None,
            duration_ms: 0,
            timed_out: false,
            output: String::new(),
            stderr: error.to_string(),
        },
    }
}

#[tauri::command]
async fn list_grok_plugins(cwd: Option<String>) -> ToolRun {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    let cwd = normalized_cwd(cwd);
    match tauri::async_runtime::spawn_blocking(move || {
        run_external_command(
            &program,
            vec!["plugin".to_string(), "list".to_string()],
            Some(cwd),
            command_timeout_secs(10),
        )
    })
    .await
    {
        Ok(run) => run,
        Err(error) => ToolRun {
            ok: false,
            command: "grok plugin list".to_string(),
            cwd: String::new(),
            exit_code: None,
            duration_ms: 0,
            timed_out: false,
            output: String::new(),
            stderr: error.to_string(),
        },
    }
}

#[tauri::command]
async fn list_grok_sessions(cwd: Option<String>) -> ToolRun {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    let cwd = normalized_cwd(cwd);
    match tauri::async_runtime::spawn_blocking(move || {
        run_external_command(
            &program,
            vec!["sessions".to_string(), "list".to_string()],
            Some(cwd),
            command_timeout_secs(10),
        )
    })
    .await
    {
        Ok(run) => run,
        Err(error) => ToolRun {
            ok: false,
            command: "grok sessions list".to_string(),
            cwd: String::new(),
            exit_code: None,
            duration_ms: 0,
            timed_out: false,
            output: String::new(),
            stderr: error.to_string(),
        },
    }
}

#[tauri::command]
fn run_browser_task(task: String, max_steps: u16) -> ToolRun {
    let python = env::var("GROK_DESKTOP_PYTHON").unwrap_or_else(|_| "python3".to_string());
    let script = script_path("browser_automation.py");
    run_external_command(
        &python,
        vec![
            script.to_string_lossy().to_string(),
            "--task".to_string(),
            task,
            "--max-steps".to_string(),
            max_steps.to_string(),
        ],
        None,
        command_timeout_secs(360),
    )
}

#[tauri::command]
fn run_absorb_repo(repo_path: String, copy_text: bool) -> ToolRun {
    let python = env::var("GROK_DESKTOP_PYTHON").unwrap_or_else(|_| "python3".to_string());
    let script = script_path("absorb_repo.py");
    let mut args = vec![
        script.to_string_lossy().to_string(),
        repo_path,
        "--output".to_string(),
        absorbed_output_root().to_string_lossy().to_string(),
    ];

    if copy_text {
        args.push("--copy-text".to_string());
    }

    run_external_command(&python, args, None, command_timeout_secs(360))
}

#[tauri::command]
fn run_doctor() -> ToolRun {
    let python = env::var("GROK_DESKTOP_PYTHON").unwrap_or_else(|_| "python3".to_string());
    let script = script_path("doctor.py");
    run_external_command(
        &python,
        vec![script.to_string_lossy().to_string()],
        None,
        command_timeout_secs(60),
    )
}

#[tauri::command]
fn get_chrome_bridge_state() -> ChromeBridgeState {
    let state_path = chrome_bridge_state_path();
    match fs::read_to_string(&state_path) {
        Ok(raw) => match serde_json::from_str::<ChromeBridgeFile>(&raw) {
            Ok(state) => ChromeBridgeState {
                ok: true,
                connected: state.connected,
                host_name: "com.grok.desktop.native".to_string(),
                extension_id: state.extension_id,
                updated_at: state.updated_at,
                state_path: state_path.to_string_lossy().to_string(),
                tabs: state.tabs,
                settings: state.settings,
                last_error: state.last_error,
            },
            Err(error) => ChromeBridgeState {
                ok: false,
                connected: false,
                host_name: "com.grok.desktop.native".to_string(),
                extension_id: None,
                updated_at: None,
                state_path: state_path.to_string_lossy().to_string(),
                tabs: Vec::new(),
                settings: ChromeBridgeSettings {
                    focus_guard: true,
                    visible_motion: true,
                    controlled_tabs_only: true,
                },
                last_error: Some(format!("Could not parse Chrome bridge state: {error}")),
            },
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => ChromeBridgeState {
            ok: true,
            connected: false,
            host_name: "com.grok.desktop.native".to_string(),
            extension_id: None,
            updated_at: None,
            state_path: state_path.to_string_lossy().to_string(),
            tabs: Vec::new(),
            settings: ChromeBridgeSettings {
                focus_guard: true,
                visible_motion: true,
                controlled_tabs_only: true,
            },
            last_error: Some(
                "No Chrome bridge state yet. Install the native host and open the extension."
                    .to_string(),
            ),
        },
        Err(error) => ChromeBridgeState {
            ok: false,
            connected: false,
            host_name: "com.grok.desktop.native".to_string(),
            extension_id: None,
            updated_at: None,
            state_path: state_path.to_string_lossy().to_string(),
            tabs: Vec::new(),
            settings: ChromeBridgeSettings {
                focus_guard: true,
                visible_motion: true,
                controlled_tabs_only: true,
            },
            last_error: Some(error.to_string()),
        },
    }
}

#[tauri::command]
fn install_chrome_native_host(extension_id: String) -> ToolRun {
    let python = env::var("GROK_DESKTOP_PYTHON").unwrap_or_else(|_| "python3".to_string());
    let script = script_path("install_chrome_native_host.py");
    run_external_command(
        &python,
        vec![
            script.to_string_lossy().to_string(),
            "--extension-id".to_string(),
            extension_id,
        ],
        None,
        command_timeout_secs(30),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_tool_statuses,
            load_session_state,
            save_session_state,
            get_grok_auth_status,
            start_grok_login,
            run_grok_task,
            run_grok_streaming_task,
            run_shell_command,
            inspect_grok_environment,
            list_grok_models,
            list_grok_mcp,
            doctor_grok_mcp,
            list_grok_plugins,
            list_grok_sessions,
            run_browser_task,
            run_absorb_repo,
            run_doctor,
            get_chrome_bridge_state,
            install_chrome_native_host
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
