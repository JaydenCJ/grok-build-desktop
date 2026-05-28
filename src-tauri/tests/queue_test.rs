use grok_desktop_lib::runs::db::{Db, RunState};
use grok_desktop_lib::runs::queue::{QueueMessageKind, RunQueue};
use std::path::PathBuf;
use std::sync::Arc;

fn fake_grok_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("scripts/fake-grok.sh");
    p
}

#[tokio::test]
async fn enqueue_runs_serial_and_emits_events() {
    let db = Db::open_memory().await.unwrap();
    let (q, mut rx) = RunQueue::new(db, fake_grok_path()).await;
    let q = Arc::new(q);
    q.clone().spawn_worker();

    let (_id1, pos1) = q.enqueue("p1".into(), "/tmp".into(), vec!["--ok".into()]).await.unwrap();
    let (_id2, pos2) = q.enqueue("p2".into(), "/tmp".into(), vec!["--ok".into()]).await.unwrap();
    assert_eq!(pos1, 0);
    assert_eq!(pos2, 1);

    // Collect events for ~5s.
    let mut events = Vec::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await {
            Ok(Some(msg)) => events.push(msg),
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

#[tokio::test]
async fn cancel_queued_marks_cancelled_without_running() {
    let db = Db::open_memory().await.unwrap();
    let (q, _rx) = RunQueue::new(db.clone(), fake_grok_path()).await;
    let q = Arc::new(q);
    // Do NOT spawn worker — we want to inspect waiting queue state directly.

    let (id, _) = q.enqueue("p".into(), "/tmp".into(), vec!["--ok".into()]).await.unwrap();
    let cancelled = q.cancel(&id).await.unwrap();
    assert!(cancelled);

    let rec = db.fetch_run(&id).await.unwrap().unwrap();
    assert!(matches!(rec.state, RunState::Cancelled));
}
