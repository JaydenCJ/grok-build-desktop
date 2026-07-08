// `desktop` uses osascript so it only compiles on macOS. On other targets we
// expose a stub with the same signatures returning "unsupported" errors, so
// the Tauri command registration stays portable.
#[cfg(target_os = "macos")]
pub mod desktop;
#[cfg(not(target_os = "macos"))]
pub mod desktop {
    use serde::Serialize;
    #[derive(Debug, Clone, Serialize)]
    pub struct AppInfo {
        pub name: String,
        pub bundle_id: String,
        pub running: bool,
        pub capabilities: Vec<String>,
    }
    #[tauri::command]
    pub fn desktop_list_apps() -> Vec<AppInfo> {
        Vec::new()
    }
    #[tauri::command]
    pub fn desktop_query(_action: String) -> Result<String, String> {
        Err("desktop bridge is macOS-only".into())
    }
    #[tauri::command]
    pub fn desktop_activate(_app: String) -> Result<(), String> {
        Err("desktop bridge is macOS-only".into())
    }
}
pub mod prompts;
pub mod runs;

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    env, fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use tauri::Manager;
use crate::runs::db::Db;
use crate::runs::queue::{QueueMessage, QueueMessageKind, RunQueue};

#[cfg(unix)]
extern "C" {
    fn setpgid(pid: i32, pgid: i32) -> i32;
}

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
    theme_mode: Option<String>,
    last_run: Option<ToolRun>,
    history: Vec<ToolRun>,
    messages: serde_json::Value,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StaticPreviewFile {
    name: String,
    path: String,
    kind: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StaticPreview {
    available: bool,
    root: String,
    entry_path: String,
    html: String,
    files: Vec<StaticPreviewFile>,
    detail: String,
    updated_at: u128,
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

fn is_noisy_grok_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.len() < 21 {
        return false;
    }
    let head: String = trimmed.chars().take(20).collect();
    let mut iter = head.chars();
    let looks_like_iso = (0..4).all(|_| iter.next().is_some_and(|c| c.is_ascii_digit()))
        && iter.next() == Some('-')
        && (0..2).all(|_| iter.next().is_some_and(|c| c.is_ascii_digit()))
        && iter.next() == Some('-')
        && (0..2).all(|_| iter.next().is_some_and(|c| c.is_ascii_digit()))
        && iter.next() == Some('T');
    if !looks_like_iso {
        return false;
    }
    let upper = trimmed.to_uppercase();
    upper.contains(" INFO ")
        || upper.contains(" DEBUG ")
        || upper.contains(" TRACE ")
        || upper.contains(" WARN ")
        || upper.contains(" ERROR ")
}

fn verbose_grok_stderr() -> bool {
    matches!(
        env::var("GROK_DESKTOP_VERBOSE_GROK_STDERR").as_deref(),
        Ok("1" | "true" | "yes" | "on")
    )
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

/// Resolve the grok binary for the run queue. Honors GROK_DESKTOP_GROK_CMD
/// (absolute path or bare name), otherwise searches the same augmented PATH
/// (`command_path()`) that every status/one-shot command already uses, so
/// "installed" in the UI and "runnable" by the queue agree. Falls back to the
/// legacy ~/.grok/bin/grok literal if nothing is found (spawn will then
/// report a clear not-found error).
fn resolve_grok_binary() -> PathBuf {
    let configured = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    let candidate = PathBuf::from(&configured);
    // Absolute/relative path that exists → use as-is.
    if candidate.exists() {
        return candidate;
    }
    // Bare command name (or a missing path): search the augmented PATH for
    // an executable file with that name.
    let name = candidate
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or(configured);
    for dir in command_path().split(':') {
        if dir.is_empty() {
            continue;
        }
        let full = Path::new(dir).join(&name);
        if full.is_file() {
            return full;
        }
    }
    let home = env::var("HOME").unwrap_or_default();
    PathBuf::from(format!("{home}/.grok/bin/grok"))
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

fn prepare_child_process(command: &mut Command) {
    #[cfg(unix)]
    unsafe {
        command.pre_exec(|| {
            if setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        });
    }
}

fn child_pids(pid: u32) -> Vec<u32> {
    Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|line| line.trim().parse::<u32>().ok())
                .collect()
        })
        .unwrap_or_default()
}

fn collect_process_tree(pid: u32, seen: &mut HashSet<u32>) {
    if !seen.insert(pid) {
        return;
    }

    for child in child_pids(pid) {
        collect_process_tree(child, seen);
    }
}

fn terminate_pid_tree(pid: u32) {
    #[cfg(unix)]
    {
        let process_group = format!("-{pid}");
        let _ = Command::new("kill").args(["-TERM", &process_group]).status();

        let mut processes = HashSet::new();
        collect_process_tree(pid, &mut processes);
        for child_pid in processes.iter().copied().filter(|child_pid| *child_pid != pid) {
            let _ = Command::new("kill")
                .args(["-TERM", &child_pid.to_string()])
                .status();
        }

        thread::sleep(Duration::from_millis(250));

        let _ = Command::new("kill").args(["-KILL", &process_group]).status();
        for child_pid in processes.iter().copied().filter(|child_pid| *child_pid != pid) {
            let _ = Command::new("kill")
                .args(["-KILL", &child_pid.to_string()])
                .status();
        }
    }
}

fn terminate_child_tree(child: &mut Child) {
    terminate_pid_tree(child.id());
    let _ = child.kill();
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
    let mut command = Command::new(program);
    command
        .args(&args)
        .current_dir(&cwd)
        .env("PATH", command_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepare_child_process(&mut command);
    let spawn_result = command.spawn();

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
        let verbose = verbose_grok_stderr();
        reader_threads.push(thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let cleaned = strip_ansi_codes(&line);
                if !verbose && is_noisy_grok_line(&cleaned) {
                    continue;
                }
                if let Ok(mut buffer) = output.lock() {
                    buffer.push_str(&cleaned);
                    buffer.push('\n');
                }
            }
        }));
    }

    if let Some(stderr) = stderr {
        let error_output = Arc::clone(&error_output);
        let verbose = verbose_grok_stderr();
        reader_threads.push(thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let cleaned = strip_ansi_codes(&line);
                if !verbose && is_noisy_grok_line(&cleaned) {
                    continue;
                }
                if let Ok(mut buffer) = error_output.lock() {
                    buffer.push_str(&cleaned);
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
                terminate_child_tree(&mut child);
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

/// Run a blocking ToolRun-producing closure on the async runtime's thread
/// pool. Non-async #[tauri::command] fns execute on the MAIN thread in
/// Tauri 2, so a long-running child process (shell command: 600s budget)
/// froze the entire app — window events, IPC, and run-event streaming —
/// until it exited. `label` is the command name reported if the task fails
/// to join.
async fn spawn_tool_run(
    label: &str,
    f: impl FnOnce() -> ToolRun + Send + 'static,
) -> ToolRun {
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(run) => run,
        Err(error) => ToolRun {
            ok: false,
            command: label.to_string(),
            cwd: String::new(),
            exit_code: None,
            duration_ms: 0,
            timed_out: false,
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

fn session_state_path() -> PathBuf {
    app_support_dir().join("session_state.json")
}

fn grok_home_dir() -> PathBuf {
    env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".grok")
}

// ── Grok skills ─────────────────────────────────────────────────────────────
// A skill is a folder with a SKILL.md (frontmatter name/description + body).
// grok-build discovers them from ~/.grok/skills (and ~/.claude/skills). We let
// users install a curated catalog with one click — install just writes the
// SKILL.md; grok picks it up on the next run.
fn grok_skills_dir() -> PathBuf {
    grok_home_dir().join("skills")
}

fn safe_skill_slug(slug: &str) -> Result<String, String> {
    let s = slug.trim();
    if s.is_empty()
        || s.contains('/')
        || s.contains('\\')
        || s.contains("..")
        || !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid skill name".into());
    }
    Ok(s.to_string())
}

#[tauri::command]
fn list_grok_skills() -> Vec<String> {
    let mut out = Vec::new();
    for base in [grok_skills_dir(), grok_home_dir().with_file_name(".claude").join("skills")] {
        if let Ok(rd) = fs::read_dir(&base) {
            for entry in rd.flatten() {
                if entry.path().join("SKILL.md").exists() {
                    if let Some(name) = entry.file_name().to_str() {
                        if !out.contains(&name.to_string()) {
                            out.push(name.to_string());
                        }
                    }
                }
            }
        }
    }
    out
}

#[tauri::command]
fn install_grok_skill(slug: String, body: String) -> Result<(), String> {
    let slug = safe_skill_slug(&slug)?;
    let dir = grok_skills_dir().join(&slug);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    fs::write(dir.join("SKILL.md"), body).map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}

#[tauri::command]
fn remove_grok_skill(slug: String) -> Result<(), String> {
    let slug = safe_skill_slug(&slug)?;
    let dir = grok_skills_dir().join(&slug);
    // Only remove a folder we'd recognise as a skill (has SKILL.md).
    if dir.join("SKILL.md").exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("remove failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn load_session_state() -> Result<Option<SessionState>, String> {
    let path = session_state_path();
    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<SessionState>(&raw) {
            Ok(state) => Ok(Some(state)),
            Err(_) => {
                // Self-heal instead of failing every launch: quarantine the
                // corrupt file (e.g. a torn write from a crash) and start
                // with a fresh session. Most state also lives in
                // localStorage, so the practical loss is minimal.
                let _ = fs::rename(&path, path.with_extension("json.corrupt"));
                Ok(None)
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read session state: {error}")),
    }
}

/// Atomic file write: serialize to a sibling temp file, then rename over the
/// destination. `fs::write` truncates before writing, so a crash or power
/// loss mid-write used to leave truncated JSON that failed to parse on every
/// subsequent launch.
fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)
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
    write_atomic(&path, &raw).map_err(|error| format!("Could not save session state: {error}"))
}

fn preview_root(cwd: Option<String>) -> PathBuf {
    cwd.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

fn html_attr_value(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let attr_lower = attr.to_ascii_lowercase();
    let attr_pos = lower.find(&attr_lower)?;
    let after_attr = &tag[attr_pos + attr.len()..];
    let after_attr = after_attr.trim_start();
    let after_equals = after_attr.strip_prefix('=')?.trim_start();
    let quote = after_equals.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &after_equals[quote.len_utf8()..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

fn asset_path(root: &PathBuf, canonical_root: &PathBuf, reference: &str) -> Option<PathBuf> {
    let clean = reference
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim();
    if clean.is_empty()
        || clean.starts_with('/')
        || clean.starts_with("http:")
        || clean.starts_with("https:")
        || clean.starts_with("data:")
        || clean.starts_with("blob:")
        || clean.contains('\\')
    {
        return None;
    }

    let candidate = root.join(clean);
    let canonical = candidate.canonicalize().ok()?;
    if canonical.starts_with(canonical_root) && canonical.is_file() {
        Some(canonical)
    } else {
        None
    }
}

fn inline_stylesheets(mut html: String, root: &PathBuf, canonical_root: &PathBuf) -> String {
    let mut cursor = 0;
    while let Some(relative_start) = html[cursor..].to_ascii_lowercase().find("<link") {
        let start = cursor + relative_start;
        let Some(relative_end) = html[start..].find('>') else {
            break;
        };
        let end = start + relative_end + 1;
        let tag = html[start..end].to_string();
        let tag_lower = tag.to_ascii_lowercase();
        if !tag_lower.contains("stylesheet") {
            cursor = end;
            continue;
        }

        let Some(href) = html_attr_value(&tag, "href") else {
            cursor = end;
            continue;
        };
        let Some(path) = asset_path(root, canonical_root, &href) else {
            cursor = end;
            continue;
        };
        let Ok(css) = fs::read_to_string(path) else {
            cursor = end;
            continue;
        };
        let replacement = format!("<style>\n{}\n</style>", css.replace("</style", "<\\/style"));
        html.replace_range(start..end, &replacement);
        cursor = start + replacement.len();
    }
    html
}

fn inline_scripts(mut html: String, root: &PathBuf, canonical_root: &PathBuf) -> String {
    let mut cursor = 0;
    while let Some(relative_start) = html[cursor..].to_ascii_lowercase().find("<script") {
        let start = cursor + relative_start;
        let Some(relative_tag_end) = html[start..].find('>') else {
            break;
        };
        let tag_end = start + relative_tag_end + 1;
        let tag = html[start..tag_end].to_string();
        let Some(src) = html_attr_value(&tag, "src") else {
            cursor = tag_end;
            continue;
        };

        let html_lower_tail = html[tag_end..].to_ascii_lowercase();
        let Some(relative_close) = html_lower_tail.find("</script>") else {
            cursor = tag_end;
            continue;
        };
        let close_end = tag_end + relative_close + "</script>".len();
        let Some(path) = asset_path(root, canonical_root, &src) else {
            cursor = close_end;
            continue;
        };
        let Ok(script) = fs::read_to_string(path) else {
            cursor = close_end;
            continue;
        };
        let replacement = format!("<script>\n{}\n</script>", script.replace("</script", "<\\/script"));
        html.replace_range(start..close_end, &replacement);
        cursor = start + replacement.len();
    }
    html
}

fn inline_static_assets(html: String, root: &PathBuf) -> String {
    let Ok(canonical_root) = root.canonicalize() else {
        return html;
    };
    let html = inline_stylesheets(html, root, &canonical_root);
    inline_scripts(html, root, &canonical_root)
}

fn project_files(root: &PathBuf) -> Vec<StaticPreviewFile> {
    let mut files = fs::read_dir(root)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(Result::ok))
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            let kind = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("file")
                .to_ascii_lowercase();
            Some(StaticPreviewFile {
                name,
                path: path.to_string_lossy().to_string(),
                kind,
                size: metadata.len(),
            })
        })
        .collect::<Vec<_>>();
    files.sort_by(|left, right| left.name.cmp(&right.name));
    files.truncate(24);
    files
}

#[tauri::command]
async fn get_static_preview(cwd: Option<String>) -> Result<StaticPreview, String> {
    // Directory walk + asset inlining, re-invoked after cwd/run changes.
    tauri::async_runtime::spawn_blocking(move || get_static_preview_blocking(cwd))
        .await
        .map_err(|error| error.to_string())?
}

fn get_static_preview_blocking(cwd: Option<String>) -> Result<StaticPreview, String> {
    let root = preview_root(cwd);
    let files = project_files(&root);
    let entry = root.join("index.html");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    if !entry.is_file() {
        return Ok(StaticPreview {
            available: false,
            root: root.to_string_lossy().to_string(),
            entry_path: entry.to_string_lossy().to_string(),
            html: String::new(),
            files,
            detail: "Create index.html in the selected project to enable preview.".to_string(),
            updated_at: now,
        });
    }

    let html = fs::read_to_string(&entry)
        .map_err(|error| format!("Could not read static preview entry: {error}"))?;
    let html = inline_static_assets(html, &root);

    Ok(StaticPreview {
        available: true,
        root: root.to_string_lossy().to_string(),
        entry_path: entry.to_string_lossy().to_string(),
        html,
        files,
        detail: "Rendering index.html with local CSS and JavaScript inlined.".to_string(),
        updated_at: now,
    })
}

fn path_has_entries(path: &PathBuf) -> bool {
    fs::read_dir(path)
        .ok()
        .and_then(|mut entries| entries.next())
        .is_some()
}

// (The legacy run_grok_task argument builder — grok_args, grok_prompt,
// mode_context, split_template_args and their normalized_* helpers — was
// removed. It was a second, divergent way of launching grok that no
// frontend code invoked; the live path is enqueue_run + the run queue,
// with arguments built in src/App.tsx (buildGrokArgs).

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
async fn start_grok_login(device_auth: bool, cwd: Option<String>) -> ToolRun {
    spawn_tool_run("grok login", move || start_grok_login_blocking(device_auth, cwd)).await
}

fn start_grok_login_blocking(device_auth: bool, cwd: Option<String>) -> ToolRun {
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
async fn run_shell_command(command: String, cwd: Option<String>) -> ToolRun {
    spawn_tool_run("zsh -lc", move || run_shell_command_blocking(command, cwd)).await
}

fn run_shell_command_blocking(command: String, cwd: Option<String>) -> ToolRun {
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

/// Add (or update) an MCP server: `grok mcp add <name> --command <cmd> --args …`
/// for stdio transport, or `--url <url> --type <type>` for HTTP/SSE. Env vars
/// pass through as repeated `--env KEY=VALUE`.
#[tauri::command]
async fn grok_mcp_add(
    name: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    env_pairs: Option<Vec<String>>,
    url: Option<String>,
    transport_type: Option<String>,
) -> ToolRun {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    let mut argv: Vec<String> = vec!["mcp".into(), "add".into(), name];
    if let Some(cmd) = command.filter(|c| !c.trim().is_empty()) {
        argv.push("--command".into());
        argv.push(cmd);
    }
    if let Some(a) = args {
        // Emit each arg as its own `--args=VALUE`. `grok mcp add` uses clap's
        // multi-value `--args <ARGS>...`, which rejects a bare value starting
        // with '-' (e.g. npx's `-y`) as "unexpected argument '-y'". The `=`
        // form binds the value to the flag so leading-dash args are accepted.
        // Also expand a literal `$HOME` so filesystem/git servers get a real
        // path instead of the unexpanded placeholder.
        let home = env::var("HOME").unwrap_or_default();
        for arg in a {
            let expanded = if home.is_empty() {
                arg
            } else {
                arg.replace("$HOME", &home)
            };
            argv.push(format!("--args={}", expanded));
        }
    }
    if let Some(envs) = env_pairs {
        for e in envs.into_iter().filter(|e| !e.trim().is_empty()) {
            argv.push("--env".into());
            argv.push(e);
        }
    }
    if let Some(u) = url.filter(|u| !u.trim().is_empty()) {
        argv.push("--url".into());
        argv.push(u);
    }
    if let Some(t) = transport_type.filter(|t| !t.trim().is_empty()) {
        argv.push("--type".into());
        argv.push(t);
    }
    match tauri::async_runtime::spawn_blocking(move || {
        run_external_command(&program, argv, None, command_timeout_secs(30))
    })
    .await
    {
        Ok(run) => run,
        Err(error) => ToolRun {
            ok: false,
            command: "grok mcp add".to_string(),
            cwd: String::new(),
            exit_code: None,
            duration_ms: 0,
            timed_out: false,
            output: String::new(),
            stderr: error.to_string(),
        },
    }
}

/// Remove a configured MCP server: `grok mcp remove <name>`.
#[tauri::command]
async fn grok_mcp_remove(name: String) -> ToolRun {
    let program = env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| "grok".to_string());
    match tauri::async_runtime::spawn_blocking(move || {
        run_external_command(
            &program,
            vec!["mcp".to_string(), "remove".to_string(), name],
            None,
            command_timeout_secs(15),
        )
    })
    .await
    {
        Ok(run) => run,
        Err(error) => ToolRun {
            ok: false,
            command: "grok mcp remove".to_string(),
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
async fn run_browser_task(task: String, max_steps: u16) -> ToolRun {
    spawn_tool_run("browser_automation.py", move || run_browser_task_blocking(task, max_steps)).await
}

fn run_browser_task_blocking(task: String, max_steps: u16) -> ToolRun {
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
async fn run_absorb_repo(repo_path: String, copy_text: bool) -> ToolRun {
    spawn_tool_run("absorb_repo.py", move || run_absorb_repo_blocking(repo_path, copy_text)).await
}

fn run_absorb_repo_blocking(repo_path: String, copy_text: bool) -> ToolRun {
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
async fn run_doctor() -> ToolRun {
    spawn_tool_run("doctor.py", run_doctor_blocking).await
}

fn run_doctor_blocking() -> ToolRun {
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
async fn pick_project_folder(initial: Option<String>) -> Result<Option<String>, String> {
    // osascript blocks until the dialog closes — keep it off the main thread.
    tauri::async_runtime::spawn_blocking(move || pick_project_folder_blocking(initial))
        .await
        .map_err(|error| error.to_string())?
}

fn pick_project_folder_blocking(initial: Option<String>) -> Result<Option<String>, String> {
    let starting_dir = initial
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .and_then(|value| {
            let candidate = PathBuf::from(&value);
            if candidate.is_dir() {
                Some(value)
            } else {
                None
            }
        });

    let default_clause = match starting_dir {
        Some(path) => format!(" default location (POSIX file {})", applescript_quote(&path)),
        None => String::new(),
    };

    let script = format!(
        "try\n  set chosen to POSIX path of (choose folder with prompt \"Select project folder for Grok Desktop\"{default_clause})\n  return chosen\non error number -128\n  return \"\"\nend try"
    );

    let output = Command::new("osascript")
        .args(["-e", &script])
        .env("PATH", command_path())
        .output()
        .map_err(|error| format!("Could not launch folder picker: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Ok(None);
        }
        return Err(format!("Folder picker failed: {stderr}"));
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return Ok(None);
    }

    let cleaned = raw.trim_end_matches('/').to_string();
    Ok(Some(cleaned))
}

// ── New queue commands ──────────────────────────────────────────────────────

#[tauri::command]
async fn enqueue_run(
    queue: tauri::State<'_, std::sync::Arc<RunQueue>>,
    prompt: String,
    cwd: String,
    args: Vec<String>,
) -> Result<serde_json::Value, String> {
    let (run_id, position) = queue
        .enqueue(prompt, cwd, args)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "runId": run_id, "position": position }))
}

#[tauri::command]
async fn cancel_run(
    queue: tauri::State<'_, std::sync::Arc<RunQueue>>,
    run_id: String,
) -> Result<bool, String> {
    queue.cancel(&run_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_queue(
    queue: tauri::State<'_, std::sync::Arc<RunQueue>>,
) -> Result<serde_json::Value, String> {
    let (active, waiting) = queue.snapshot().await;
    Ok(serde_json::json!({
        "active": active,
        "queue": waiting.iter().map(|r| serde_json::json!({
            "id": r.id, "prompt": r.prompt, "cwd": r.cwd,
            "state": r.state, "enqueuedAt": r.enqueued_at,
        })).collect::<Vec<_>>(),
    }))
}

#[tauri::command]
async fn clear_queue(
    queue: tauri::State<'_, std::sync::Arc<RunQueue>>,
) -> Result<u64, String> {
    queue.clear_waiting().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn resume_pending_runs(
    queue: tauri::State<'_, std::sync::Arc<RunQueue>>,
) -> Result<u64, String> {
    let count = queue.pending_count().await;
    queue.notify_worker();
    Ok(count as u64)
}

#[tauri::command]
async fn cancel_pending_runs(
    queue: tauri::State<'_, std::sync::Arc<RunQueue>>,
) -> Result<u64, String> {
    queue.cancel_all_pending().await.map_err(|e| e.to_string())
}

// ── Prompt library (D) ──────────────────────────────────────────────────────

#[tauri::command]
async fn list_prompts(
    store: tauri::State<'_, crate::prompts::PromptStore>,
) -> Result<Vec<crate::prompts::Prompt>, String> {
    store.list().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn upsert_prompt(
    store: tauri::State<'_, crate::prompts::PromptStore>,
    name: String,
    body: String,
    category: Option<String>,
    id: Option<String>,
) -> Result<crate::prompts::Prompt, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let (resolved_id, created_at) = match id {
        Some(existing) if !existing.trim().is_empty() => {
            let prior = store
                .list()
                .await
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|p| p.id == existing);
            let created_at = prior.map(|p| p.created_at).unwrap_or(now);
            (existing, created_at)
        }
        _ => (uuid::Uuid::now_v7().to_string(), now),
    };
    let prompt = crate::prompts::Prompt {
        id: resolved_id,
        name: name.trim().to_string(),
        category: category.and_then(|c| {
            let trimmed = c.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }),
        body,
        created_at,
        updated_at: now,
    };
    store.upsert(&prompt).await.map_err(|e| e.to_string())?;
    Ok(prompt)
}

#[tauri::command]
async fn delete_prompt(
    store: tauri::State<'_, crate::prompts::PromptStore>,
    id: String,
) -> Result<bool, String> {
    store.delete(&id).await.map_err(|e| e.to_string())
}

// ── @file references (B sub-project MVP) ────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,           // path relative to cwd
    pub display_name: String,   // basename for the picker UI
    pub size_bytes: u64,
}

/// `.gitignore`-aware fuzzy file search rooted at `cwd`. Used by the @file
/// picker in the Composer. The query is matched against the relative path —
/// case-insensitive contiguous substring, then ranked by:
///   1. exact basename match
///   2. basename contains
///   3. path contains
/// Hard caps: scan ≤ 25_000 entries (skips the rest), return ≤ `limit`.
#[tauri::command]
async fn glob_files(cwd: String, query: String, limit: usize) -> Result<Vec<FileEntry>, String> {
    // Walks up to 25k gitignore-filtered entries — off the main thread.
    tauri::async_runtime::spawn_blocking(move || glob_files_blocking(cwd, query, limit))
        .await
        .map_err(|error| error.to_string())?
}

fn glob_files_blocking(cwd: String, query: String, limit: usize) -> Result<Vec<FileEntry>, String> {
    use ignore::WalkBuilder;
    let root = std::path::PathBuf::from(&cwd);
    if !root.is_dir() {
        return Err(format!("cwd is not a directory: {cwd}"));
    }
    let needle = query.trim().to_lowercase();
    let limit = limit.clamp(1, 200);

    let mut hits: Vec<(u32, FileEntry)> = Vec::new(); // (rank, entry) — lower rank = better
    let mut scanned = 0usize;
    let walker = WalkBuilder::new(&root)
        .hidden(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .max_depth(Some(12))
        .build();
    for dent in walker {
        scanned += 1;
        if scanned > 25_000 {
            break;
        }
        let Ok(entry) = dent else { continue };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let abs = entry.path();
        let Ok(rel) = abs.strip_prefix(&root) else { continue };
        let rel_str = rel.to_string_lossy().to_string();
        let base = abs
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if base.starts_with('.') {
            continue;
        }
        let lower_rel = rel_str.to_lowercase();
        let lower_base = base.to_lowercase();
        let rank: u32 = if needle.is_empty() {
            5_000
        } else if lower_base == needle {
            0
        } else if lower_base.starts_with(&needle) {
            10
        } else if lower_base.contains(&needle) {
            100
        } else if lower_rel.contains(&needle) {
            500
        } else {
            continue;
        };
        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        hits.push((
            rank,
            FileEntry {
                path: rel_str,
                display_name: base,
                size_bytes,
            },
        ));
    }
    hits.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.path.cmp(&b.1.path)));
    Ok(hits.into_iter().take(limit).map(|(_, e)| e).collect())
}

/// Read a file as UTF-8 text, with a hard size cap so a 100MB file doesn't
/// blow up the IPC channel. Returns `None` if the file is binary or oversized.
#[tauri::command]
async fn read_file_safe(cwd: String, path: String, max_bytes: usize) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || read_file_safe_blocking(cwd, path, max_bytes))
        .await
        .map_err(|error| error.to_string())?
}

fn read_file_safe_blocking(cwd: String, path: String, max_bytes: usize) -> Result<Option<String>, String> {
    let root = std::path::PathBuf::from(&cwd);
    let candidate = root.join(&path);
    // Path traversal guard: canonicalize and verify it's still under root.
    let canon = candidate
        .canonicalize()
        .map_err(|e| format!("canonicalize failed: {e}"))?;
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("cwd canonicalize failed: {e}"))?;
    if !canon.starts_with(&root_canon) {
        return Err(format!("path escapes cwd: {path}"));
    }
    let cap = max_bytes.clamp(1, 1_000_000); // 1MB hard ceiling
    let metadata = std::fs::metadata(&canon).map_err(|e| format!("stat failed: {e}"))?;
    if metadata.len() as usize > cap {
        return Ok(None);
    }
    let bytes = std::fs::read(&canon).map_err(|e| format!("read failed: {e}"))?;
    // Heuristic binary detection: any NUL byte in the first 8KB.
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return Ok(None);
    }
    match String::from_utf8(bytes) {
        Ok(s) => Ok(Some(s)),
        Err(_) => Ok(None),
    }
}

// ── Agent overlay (G2) ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OverlayState {
    visible: bool,
    label: Option<String>,
    mode: Option<String>,
    action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OverlayCursor {
    x: f64,
    y: f64,
    label: Option<String>,
    action: Option<String>,
}

/// Show or hide the always-on-top agent overlay window and push state to it.
#[tauri::command]
async fn set_agent_overlay(
    app: tauri::AppHandle,
    payload: OverlayState,
) -> Result<(), String> {
    use tauri::{Emitter as _, Manager as _};
    let window = app
        .get_webview_window("agent-overlay")
        .ok_or_else(|| "agent-overlay window not configured".to_string())?;

    if payload.visible {
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_ignore_cursor_events(true);
    } else {
        window.hide().map_err(|e| e.to_string())?;
    }

    let _ = window.emit("grok-desktop://overlay-state", &payload);
    Ok(())
}

/// Update the position/label/action of the agent cursor sprite in the overlay.
#[tauri::command]
async fn set_agent_cursor(
    app: tauri::AppHandle,
    payload: OverlayCursor,
) -> Result<(), String> {
    use tauri::{Emitter as _, Manager as _};
    let window = app
        .get_webview_window("agent-overlay")
        .ok_or_else(|| "agent-overlay window not configured".to_string())?;
    let _ = window.emit("grok-desktop://overlay-cursor", &payload);
    Ok(())
}

// ── Event forwarder ─────────────────────────────────────────────────────────

fn forward_queue_message(app: &tauri::AppHandle, msg: &QueueMessage) {
    use tauri::Emitter as _;
    match &msg.kind {
        QueueMessageKind::Event { event, raw } => {
            let _ = app.emit("grok-desktop://run-event", serde_json::json!({
                "runId": msg.run_id,
                "event": event,
                "raw": raw,
            }));
        }
        QueueMessageKind::StateChanged { state, started_at, ended_at, error } => {
            let _ = app.emit("grok-desktop://run-state-changed", serde_json::json!({
                "runId": msg.run_id,
                "state": state,
                "startedAt": started_at,
                "endedAt": ended_at,
                "error": error,
            }));
        }
        QueueMessageKind::QueueChanged => {
            let q = app.state::<std::sync::Arc<RunQueue>>().inner().clone();
            let app_cloned = app.clone();
            tauri::async_runtime::spawn(async move {
                let (active, waiting) = q.snapshot().await;
                let _ = app_cloned.emit("grok-desktop://queue-changed", serde_json::json!({
                    "active": active,
                    "queue": waiting.iter().map(|r| serde_json::json!({
                        "id": r.id, "prompt": r.prompt, "cwd": r.cwd,
                        "state": r.state, "enqueuedAt": r.enqueued_at,
                    })).collect::<Vec<_>>(),
                }));
            });
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            // Fall back to a temp location rather than panicking pre-WebView
            // if the platform data dir can't be resolved.
            let resource_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("grok-desktop"));
            std::fs::create_dir_all(&resource_dir).ok();
            let db_path = resource_dir.join("runs.sqlite");

            tauri::async_runtime::block_on(async {
                // A corrupt/unopenable runs.sqlite (torn write, disk-full,
                // downgraded schema) must not brick every launch — the old
                // .expect() panicked before the WebView even loaded, so the
                // frontend's own recovery UI never appeared. Quarantine the
                // bad file and retry; fall back to an in-memory DB so the app
                // still boots (queue history is lost, the app is usable).
                let db = match Db::open_at(&db_path).await {
                    Ok(db) => db,
                    Err(first_err) => {
                        eprintln!(
                            "[grok-desktop] runs.sqlite failed to open ({first_err}); quarantining and retrying"
                        );
                        let _ = std::fs::rename(&db_path, db_path.with_extension("sqlite.bak"));
                        match Db::open_at(&db_path).await {
                            Ok(db) => db,
                            Err(second_err) => {
                                eprintln!(
                                    "[grok-desktop] retry failed ({second_err}); using in-memory run store"
                                );
                                Db::open_memory().await.expect("open in-memory runs db")
                            }
                        }
                    }
                };

                // One-shot migration: if session_state.json has a non-empty history array,
                // import as Done runs in SQLite, then clear the field.
                // ToolRun fields in JSON are snake_case: ok, command, cwd, exit_code, duration_ms, timed_out, output, stderr
                // There is no timestamp field — use current time as approximation.
                let session_path = app_support_dir().join("session_state.json");
                if let Ok(content) = std::fs::read_to_string(&session_path) {
                    if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(history) = v.get("history").and_then(|h| h.as_array()).cloned() {
                            if !history.is_empty() {
                                let now_ms = chrono::Utc::now().timestamp_millis();
                                for item in &history {
                                    let id = uuid::Uuid::now_v7().to_string();
                                    let prompt = item.get("command").and_then(|p| p.as_str()).unwrap_or("").to_string();
                                    let cwd = item.get("cwd").and_then(|c| c.as_str()).unwrap_or("/").to_string();
                                    let rec = crate::runs::db::RunRecord {
                                        id,
                                        prompt,
                                        cwd,
                                        args_json: "[]".into(),
                                        state: crate::runs::db::RunState::Done,
                                        enqueued_at: now_ms,
                                        started_at: Some(now_ms),
                                        ended_at: Some(now_ms),
                                        stop_reason: Some("legacy".into()),
                                        error: None,
                                    };
                                    let _ = db.insert_run(&rec).await;
                                }
                            }
                            v.as_object_mut().and_then(|o| o.remove("history"));
                            // Skip the write entirely on a serialize error —
                            // unwrap_or_default() would have TRUNCATED the
                            // session file to an empty string. Atomic rename
                            // so a crash mid-write can't tear it either.
                            if let Ok(serialized) = serde_json::to_string_pretty(&v) {
                                let _ = write_atomic(&session_path, &serialized);
                            }
                        }
                    }
                }

                // Resolve the grok binary the same way every other command
                // does (augmented PATH incl. homebrew and npm global bins).
                // The queue used to spawn a hardcoded literal path and
                // process::spawn hard-fails when it doesn't exist — so an
                // npm-installed grok showed "Grok ready / Connected"
                // everywhere while every chat run failed with "binary not
                // found". A bare name from GROK_DESKTOP_GROK_CMD (the value
                // .env.example documents) broke the same way.
                let grok_path = resolve_grok_binary();
                let (queue, mut rx) = RunQueue::new(db.clone(), grok_path).await;
                let queue = std::sync::Arc::new(queue);
                queue.clone().spawn_worker();

                // Event forwarder: queue messages → Tauri events.
                let app_for_events = app_handle.clone();
                let db_for_events = db.clone();
                tauri::async_runtime::spawn(async move {
                    use tauri::Emitter as _;
                    use tokio::sync::broadcast::error::RecvError;
                    let mut last_run_id: Option<String> = None;
                    loop {
                        match rx.recv().await {
                            Ok(msg) => {
                                last_run_id = Some(msg.run_id.clone());
                                forward_queue_message(&app_for_events, &msg);
                            }
                            Err(RecvError::Lagged(n)) => {
                                eprintln!("[grok-desktop] tauri event forwarder lagged, dropped {n} messages; resyncing");
                                // The dropped window may have contained a
                                // terminal StateChanged — resync from the DB
                                // so no run stays stuck "streaming"/"working…"
                                // in the UI until restart. (Dropped mid-stream
                                // text chunks are unrecoverable; state is.)
                                if let Some(id) = last_run_id.clone() {
                                    if let Ok(Some(rec)) = db_for_events.fetch_run(&id).await {
                                        let _ = app_for_events.emit(
                                            "grok-desktop://run-state-changed",
                                            serde_json::json!({
                                                "runId": rec.id,
                                                "state": rec.state,
                                                "startedAt": rec.started_at,
                                                "endedAt": rec.ended_at,
                                                "error": rec.error,
                                            }),
                                        );
                                    }
                                }
                                forward_queue_message(
                                    &app_for_events,
                                    &QueueMessage {
                                        run_id: String::new(),
                                        kind: QueueMessageKind::QueueChanged,
                                    },
                                );
                            }
                            Err(RecvError::Closed) => break,
                        }
                    }
                });

                // 6-hour vacuum loop.
                let db_for_vacuum = db.clone();
                tauri::async_runtime::spawn(async move {
                    let week_ms: i64 = 7 * 24 * 60 * 60 * 1000;
                    loop {
                        let _ = db_for_vacuum.vacuum(week_ms).await;
                        tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
                    }
                });

                // Prompt library (D) — open store next to runs.sqlite. Same
                // quarantine + in-memory fallback as runs.sqlite above.
                let prompts_path = resource_dir.join("prompts.sqlite");
                let prompts = match crate::prompts::PromptStore::open_at(&prompts_path).await {
                    Ok(store) => store,
                    Err(first_err) => {
                        eprintln!(
                            "[grok-desktop] prompts.sqlite failed to open ({first_err}); quarantining and retrying"
                        );
                        let _ =
                            std::fs::rename(&prompts_path, prompts_path.with_extension("sqlite.bak"));
                        match crate::prompts::PromptStore::open_at(&prompts_path).await {
                            Ok(store) => store,
                            Err(second_err) => {
                                eprintln!(
                                    "[grok-desktop] retry failed ({second_err}); using in-memory prompt store"
                                );
                                crate::prompts::PromptStore::open_memory()
                                    .await
                                    .expect("open in-memory prompt store")
                            }
                        }
                    }
                };
                app_handle.manage(prompts);

                app_handle.manage(queue);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_tool_statuses,
            load_session_state,
            save_session_state,
            get_grok_auth_status,
            start_grok_login,
            run_shell_command,
            get_static_preview,
            inspect_grok_environment,
            list_grok_models,
            list_grok_mcp,
            doctor_grok_mcp,
            grok_mcp_add,
            grok_mcp_remove,
            list_grok_plugins,
            list_grok_sessions,
            list_grok_skills,
            install_grok_skill,
            remove_grok_skill,
            run_browser_task,
            run_absorb_repo,
            run_doctor,
            pick_project_folder,
            enqueue_run,
            cancel_run,
            get_queue,
            clear_queue,
            resume_pending_runs,
            cancel_pending_runs,
            list_prompts,
            upsert_prompt,
            delete_prompt,
            glob_files,
            read_file_safe,
            desktop::desktop_list_apps,
            desktop::desktop_query,
            desktop::desktop_activate,
            set_agent_overlay,
            set_agent_cursor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
