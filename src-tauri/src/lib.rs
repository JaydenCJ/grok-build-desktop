pub mod runs;

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    env, fs,
    io::{BufRead, BufReader},
    path::PathBuf,
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
    chrome_extension_id: Option<String>,
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

fn grok_max_turns(default_turns: u8) -> u8 {
    env::var("GROK_DESKTOP_GROK_MAX_TURNS")
        .ok()
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|value| (1..=40).contains(value))
        .unwrap_or(default_turns)
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
fn get_static_preview(cwd: Option<String>) -> Result<StaticPreview, String> {
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

fn mode_context(mode: &str) -> &'static str {
    match mode {
        "coding" => {
            "Grok Desktop Grok Code Mode: act as a senior programming desktop assistant for professional engineers. Optimize for repository understanding, precise edits, terminal verification, and concise engineering judgment."
        }
        _ => {
            "Grok Desktop Grok Chat Mode: answer clearly, keep practical context, and hand off to Coding Mode when the task touches a repository, terminal, or code change. In every response, the first thing your text (文字) must do is clearly 吐出 (state) this core point before proceeding with the answer to the user task."
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
- For simple, short, one-sentence, read-only, or exact-format tasks, answer directly and do not perform repository mapping or use the section template.
- For analysis tasks, produce a high-signal technical readout with file paths, risks, and next actions.
- For implementation tasks, state the intended change, keep edits focused, and include verification.
- For debugging tasks, distinguish evidence, hypothesis, root cause, fix, and verification.
- For reviews, prioritize correctness, regressions, tests, security, and maintainability.

Response format:
Use `1. Summary`, `2. Files / Evidence`, `3. Changes or Recommendation`, `4. Verification commands`, and `5. Next step` for normal coding tasks only. For simple tasks, obey the user's requested format exactly.

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

    args.push("--max-turns".to_string());
    args.push(grok_max_turns(12).to_string());
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
fn pick_project_folder(initial: Option<String>) -> Result<Option<String>, String> {
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

// ── Event forwarder ─────────────────────────────────────────────────────────

fn forward_queue_message(app: &tauri::AppHandle, msg: &QueueMessage) {
    use tauri::Emitter as _;
    match &msg.kind {
        QueueMessageKind::Event { event } => {
            let _ = app.emit("grok-desktop://run-event", serde_json::json!({
                "runId": msg.run_id,
                "event": event,
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
            let resource_dir = app.path().app_data_dir().expect("app_data_dir");
            std::fs::create_dir_all(&resource_dir).ok();
            let db_path = resource_dir.join("runs.sqlite");

            tauri::async_runtime::block_on(async {
                let db = Db::open_at(&db_path).await.expect("open runs.sqlite");

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
                            let _ = std::fs::write(
                                &session_path,
                                serde_json::to_string_pretty(&v).unwrap_or_default(),
                            );
                        }
                    }
                }

                let grok_path = std::path::PathBuf::from(
                    std::env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| {
                        let home = std::env::var("HOME").unwrap_or_default();
                        format!("{}/.grok/bin/grok", home)
                    })
                );
                let (queue, mut rx) = RunQueue::new(db.clone(), grok_path).await;
                let queue = std::sync::Arc::new(queue);
                queue.clone().spawn_worker();

                // Event forwarder: queue messages → Tauri events.
                let app_for_events = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(msg) = rx.recv().await {
                        forward_queue_message(&app_for_events, &msg);
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
            run_grok_task,
            run_shell_command,
            get_static_preview,
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
            install_chrome_native_host,
            pick_project_folder,
            enqueue_run,
            cancel_run,
            get_queue,
            clear_queue,
            resume_pending_runs,
            cancel_pending_runs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
