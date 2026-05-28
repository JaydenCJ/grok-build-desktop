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

#[cfg(unix)]
pub fn spawn(cmd_path: &Path, args: &[String], cwd: &Path) -> std::io::Result<SpawnedGrok> {
    let mut command = Command::new(cmd_path);
    command
        .args(args)
        .current_dir(cwd)
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
