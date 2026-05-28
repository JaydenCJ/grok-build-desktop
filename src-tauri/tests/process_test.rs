use grok_desktop_lib::runs::process;
use std::path::PathBuf;
use tokio::io::AsyncBufReadExt;

fn fake_grok_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop(); // up from src-tauri/
    p.push("scripts/fake-grok.sh");
    p
}

#[tokio::test]
async fn spawns_and_reads_lines() {
    let path = fake_grok_path();
    let cwd = std::env::temp_dir();
    let mut spawned = process::spawn(&path, &["--ok".into()], &cwd).expect("spawn");
    let mut reader = process::read_stdout_lines(&mut spawned.child);

    let mut lines = Vec::new();
    let mut buf = String::new();
    while reader.read_line(&mut buf).await.unwrap() > 0 {
        lines.push(buf.trim().to_string());
        buf.clear();
    }
    let _ = spawned.child.wait().await;

    assert_eq!(lines.len(), 4);
    assert!(lines[0].contains("thought"));
    assert!(lines[3].contains("end"));
}

#[tokio::test]
async fn kill_group_stops_hanging_process() {
    let path = fake_grok_path();
    let cwd = std::env::temp_dir();
    let mut spawned = process::spawn(&path, &["--hang".into()], &cwd).expect("spawn");
    let pgid = spawned.pgid;

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    process::kill_group(pgid).await;

    let status = tokio::time::timeout(std::time::Duration::from_secs(5), spawned.child.wait())
        .await
        .expect("wait timed out")
        .expect("wait err");
    assert!(!status.success());
}
