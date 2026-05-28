use std::path::Path;
use std::process::Stdio;
use tokio::io::BufReader;
use tokio::process::{Child, Command};

#[cfg(unix)]
use nix::sys::signal::{killpg, Signal};
#[cfg(unix)]
use nix::unistd::Pid;

pub struct SpawnedGrok {
    pub child: Child,
    pub pgid: i32,
}

/// grok 0.2.3 takes a file lock on ~/.grok/auth.json.lock when it starts up.
/// If a previous grok process was killed (e.g. by our cancel-run or an OS
/// kill), the lock file is left behind containing "<pid>:<timestamp>". The
/// next grok run blocks indefinitely waiting on that lock — never produces
/// stdout — and our watchdog times out as if grok itself were broken.
///
/// Detect and remove stale locks: if the recorded PID no longer exists,
/// delete the lock so the new grok run can acquire it cleanly.
#[cfg(unix)]
fn cleanup_stale_grok_lock() {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return,
    };
    let lock_path = std::path::PathBuf::from(home).join(".grok/auth.json.lock");
    let contents = match std::fs::read_to_string(&lock_path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let pid_str = contents.split(':').next().unwrap_or("").trim();
    let pid: i32 = match pid_str.parse() {
        Ok(p) => p,
        Err(_) => return,
    };
    // nix::sys::signal::kill with None probes for the PID's existence without
    // sending an actual signal. Err(ESRCH) means "no such process" — stale.
    let alive = nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None).is_ok();
    if !alive {
        eprintln!(
            "[grok-desktop] process: removing stale grok lock (pid {} no longer running): {:?}",
            pid, lock_path
        );
        let _ = std::fs::remove_file(&lock_path);
    }
}

#[cfg(unix)]
pub fn spawn(cmd_path: &Path, args: &[String], cwd: &Path) -> std::io::Result<SpawnedGrok> {
    // Best-effort cleanup before each spawn — see cleanup_stale_grok_lock().
    cleanup_stale_grok_lock();

    // Resolve cwd: fall back to $HOME if the requested directory doesn't
    // exist. Common cause: user saved a project path long ago, then moved
    // or deleted the directory. Without this fallback, posix_spawn returns
    // "No such file or directory" — easy to misread as "grok binary missing".
    let resolved_cwd: std::path::PathBuf = if cwd.is_dir() {
        cwd.to_path_buf()
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        eprintln!(
            "[grok-desktop] process: cwd {:?} does not exist, falling back to {}",
            cwd, home
        );
        std::path::PathBuf::from(home)
    };

    // Also verify the binary itself exists — surfaces a clearer error if the
    // user uninstalls grok mid-session.
    if !cmd_path.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("grok binary not found at {:?}", cmd_path),
        ));
    }

    let mut command = Command::new(cmd_path);
    command
        .args(args)
        .current_dir(&resolved_cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    unsafe {
        command.pre_exec(|| {
            // Become the leader of a new process group so we can kill descendants.
            nix::unistd::setpgid(nix::unistd::Pid::from_raw(0), nix::unistd::Pid::from_raw(0))
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            Ok(())
        });
    }

    let child = command.spawn()?;
    let pgid = child.id().expect("child has pid") as i32;
    Ok(SpawnedGrok { child, pgid })
}

#[cfg(not(unix))]
pub fn spawn(_cmd_path: &Path, _args: &[String], _cwd: &Path) -> std::io::Result<SpawnedGrok> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "non-unix not supported in MVP",
    ))
}

#[cfg(unix)]
pub async fn kill_group(pgid: i32) {
    let _ = killpg(Pid::from_raw(pgid), Signal::SIGTERM);
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    let _ = killpg(Pid::from_raw(pgid), Signal::SIGKILL);
}

pub fn read_stdout_lines(child: &mut Child) -> BufReader<tokio::process::ChildStdout> {
    BufReader::new(child.stdout.take().expect("stdout piped"))
}
