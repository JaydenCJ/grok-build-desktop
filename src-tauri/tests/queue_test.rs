use grok_desktop_lib::runs::db::{Db, RunState};
use grok_desktop_lib::runs::queue::{
    keep_utf8_tail, QueueMessageKind, RunQueue, STDERR_TAIL_MAX_BYTES,
};
use std::path::PathBuf;
use std::sync::Arc;

fn fake_grok_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    // Windows cannot exec a shell script; use the batch twin (which also
    // matches production, where the grok CLI is an npm .cmd shim).
    if cfg!(windows) {
        p.push("scripts/fake-grok.cmd");
    } else {
        p.push("scripts/fake-grok.sh");
    }
    p
}

#[tokio::test]
async fn enqueue_runs_serial_and_emits_events() {
    let db = Db::open_memory().await.unwrap();
    let (q, mut rx) = RunQueue::new(db, fake_grok_path()).await;
    let q = Arc::new(q);
    q.clone().spawn_worker();

    let (_id1, pos1) = q
        .enqueue("p1".into(), "/tmp".into(), vec!["--ok".into()])
        .await
        .unwrap();
    let (_id2, pos2) = q
        .enqueue("p2".into(), "/tmp".into(), vec!["--ok".into()])
        .await
        .unwrap();
    assert_eq!(pos1, 0);
    assert_eq!(pos2, 1);

    // Collect events for ~5s.
    let mut events = Vec::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await {
            Ok(Ok(msg)) => events.push(msg),
            _ => {
                if events
                    .iter()
                    .filter(|m| {
                        matches!(
                            m.kind,
                            QueueMessageKind::StateChanged {
                                state: RunState::Done,
                                ..
                            }
                        )
                    })
                    .count()
                    >= 2
                {
                    break;
                }
            }
        }
    }

    let done_count = events
        .iter()
        .filter(|m| {
            matches!(
                m.kind,
                QueueMessageKind::StateChanged {
                    state: RunState::Done,
                    ..
                }
            )
        })
        .count();
    assert_eq!(
        done_count,
        2,
        "expected 2 Done state events, got {} (events: {:?})",
        done_count,
        events.len()
    );
}

#[test]
fn stderr_tail_truncation_cuts_on_char_boundary() {
    // 1 ASCII byte + 2000 three-byte '€' chars = 6001 bytes. The naive cut at
    // `len - 4096` = 1905 lands INSIDE a '€' (char boundaries after the prefix
    // sit at 1 + 3k, and 1905 is not of that form) — the old byte-slice
    // truncation panicked here and silently killed the stderr-drain task.
    let mut tail = format!("x{}", "€".repeat(2000));
    assert!(!tail.is_char_boundary(tail.len() - STDERR_TAIL_MAX_BYTES));

    keep_utf8_tail(&mut tail, STDERR_TAIL_MAX_BYTES);

    assert!(tail.len() <= STDERR_TAIL_MAX_BYTES);
    // A true suffix: nothing but whole '€' chars survive the cut.
    assert!(!tail.is_empty());
    assert!(tail.chars().all(|c| c == '€'));
}

#[test]
fn stderr_tail_truncation_keeps_the_end_of_ascii_input() {
    let mut tail = "a".repeat(5000);
    tail.push_str("END");
    keep_utf8_tail(&mut tail, 100);
    assert_eq!(tail.len(), 100);
    assert!(tail.ends_with("END"));
}

#[test]
fn stderr_tail_truncation_leaves_short_strings_untouched() {
    let mut tail = String::from("short error");
    keep_utf8_tail(&mut tail, STDERR_TAIL_MAX_BYTES);
    assert_eq!(tail, "short error");
}

#[tokio::test]
async fn cancel_queued_marks_cancelled_without_running() {
    let db = Db::open_memory().await.unwrap();
    let (q, _rx) = RunQueue::new(db.clone(), fake_grok_path()).await;
    let q = Arc::new(q);
    // Do NOT spawn worker — we want to inspect waiting queue state directly.

    let (id, _) = q
        .enqueue("p".into(), "/tmp".into(), vec!["--ok".into()])
        .await
        .unwrap();
    let cancelled = q.cancel(&id).await.unwrap();
    assert!(cancelled);

    let rec = db.fetch_run(&id).await.unwrap().unwrap();
    assert!(matches!(rec.state, RunState::Cancelled));
}
