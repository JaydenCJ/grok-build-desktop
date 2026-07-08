// Mac desktop bridge — a heavily constrained surface so an LLM running with
// grok credentials can READ desktop state without becoming a full computer-use
// agent. We deliberately do NOT expose generic mouse clicks, keystrokes, or
// arbitrary AppleScript execution. Every operation is:
//
//   1. Whitelisted by app name (no `osascript -e` against unknown bundles).
//   2. Pinned to a hard-coded script with no user input interpolated into it.
//   3. Read-only — the scripts query state, they don't mutate it.
//   4. Audited — every call appends to ~/.grok-desktop/audit/YYYY-MM-DD.log
//      with timestamp, action, app, and a snippet of the result.
//
// If/when we add write actions, they MUST go through a separate, opt-in path
// with explicit per-action user confirmation. Don't extend this module to do
// that — fork a new one so the read-only invariant stays auditable.

use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub bundle_id: String,
    pub running: bool,
    /// Capabilities we currently support for this app, e.g. "safari_url",
    /// "finder_selection". Frontend can introspect to enable/disable buttons.
    pub capabilities: Vec<String>,
}

/// The single source of truth for what apps may be queried.
fn allowlist() -> Vec<AppInfo> {
    vec![
        AppInfo {
            name: "Safari".into(),
            bundle_id: "com.apple.Safari".into(),
            running: is_running("Safari"),
            capabilities: vec!["safari_url".into(), "safari_title".into()],
        },
        AppInfo {
            name: "Finder".into(),
            bundle_id: "com.apple.finder".into(),
            running: is_running("Finder"),
            capabilities: vec!["finder_selection".into(), "finder_front_path".into()],
        },
        AppInfo {
            name: "iTerm".into(),
            bundle_id: "com.googlecode.iterm2".into(),
            running: is_running("iTerm"),
            capabilities: vec!["iterm_active_dir".into()],
        },
        AppInfo {
            name: "Visual Studio Code".into(),
            bundle_id: "com.microsoft.VSCode".into(),
            running: is_running("Visual Studio Code"),
            capabilities: vec![],
        },
        AppInfo {
            name: "Cursor".into(),
            bundle_id: "com.todesktop.230313mzl4w4u92".into(),
            running: is_running("Cursor"),
            capabilities: vec![],
        },
        AppInfo {
            name: "Mail".into(),
            bundle_id: "com.apple.mail".into(),
            running: is_running("Mail"),
            capabilities: vec!["mail_unread_count".into()],
        },
    ]
}

fn is_running(name: &str) -> bool {
    // `pgrep -ix "name"` returns 0 only if a matching process is alive.
    Command::new("pgrep")
        .args(["-ix", name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Execute a hard-coded AppleScript and return its stdout (trimmed).
/// Crucially, the `script` arg is a `&'static str` so call-sites can't
/// inject user input — every script is a literal in this module.
fn run_script(script: &'static str) -> Result<String, String> {
    let out = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("osascript spawn failed: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("osascript failed: {}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub fn desktop_list_apps() -> Vec<AppInfo> {
    allowlist()
}

#[tauri::command]
pub fn desktop_query(action: String) -> Result<String, String> {
    let script: &'static str = match action.as_str() {
        "safari_url" => {
            r#"tell application "Safari" to if (count of documents) > 0 then return URL of current tab of front window
return ""
"#
        }
        "safari_title" => {
            r#"tell application "Safari" to if (count of documents) > 0 then return name of current tab of front window
return ""
"#
        }
        "finder_selection" => {
            // Return newline-separated POSIX paths of currently selected items
            // in the frontmost Finder window. Empty if no selection.
            r#"tell application "Finder"
  set out to ""
  set sel to selection
  repeat with i in sel
    set out to out & (POSIX path of (i as alias)) & linefeed
  end repeat
  return out
end tell"#
        }
        "finder_front_path" => {
            r#"tell application "Finder" to try
  return POSIX path of (target of front window as alias)
on error
  return ""
end try"#
        }
        "iterm_active_dir" => {
            r#"tell application "iTerm"
  if (count of windows) is 0 then return ""
  tell current session of current tab of current window to return variable named "session.path"
end tell"#
        }
        "mail_unread_count" => r#"tell application "Mail" to return unread count of inbox"#,
        _ => return Err(format!("unsupported desktop action: {action}")),
    };
    let result = run_script(script)?;
    // Best-effort audit log; do not fail the request if we can't write it.
    let _ = audit_log(&action, &result);
    Ok(result)
}

#[tauri::command]
pub fn desktop_activate(app: String) -> Result<(), String> {
    // Bring an allowlisted app to the front. This is the only write-ish
    // action we allow — `osascript activate` is roughly equivalent to a Cmd+Tab,
    // it doesn't mutate the app's data.
    let allowed: Vec<String> = allowlist().into_iter().map(|a| a.name).collect();
    if !allowed.contains(&app) {
        return Err(format!("app not on allowlist: {app}"));
    }
    // The app name is now from a fixed allowlist, so it's safe to interpolate.
    let script = format!(r#"tell application "{}" to activate"#, app);
    Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .status()
        .map_err(|e| format!("osascript spawn failed: {e}"))?;
    let _ = audit_log(&format!("activate:{app}"), "");
    Ok(())
}

fn audit_log(action: &str, result: &str) -> std::io::Result<()> {
    let home = std::env::var("HOME").unwrap_or_default();
    if home.is_empty() {
        return Ok(());
    }
    let dir = PathBuf::from(&home).join(".grok-desktop").join("audit");
    std::fs::create_dir_all(&dir)?;
    let now = chrono::Utc::now();
    let path = dir.join(format!("{}.log", now.format("%Y-%m-%d")));
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    // First 200 chars of result is enough to spot anomalies in the audit log
    // without bloating the file when a query returns multi-page output.
    let snippet: String = result.chars().take(200).collect();
    writeln!(
        f,
        "{} action={} result_len={} snippet={:?}",
        now.to_rfc3339(),
        action,
        result.len(),
        snippet
    )?;
    Ok(())
}
