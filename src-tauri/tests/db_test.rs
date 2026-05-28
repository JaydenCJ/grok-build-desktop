use grok_desktop_lib::runs::db::{Db, RunRecord, RunState};
use chrono::Utc;

#[tokio::test]
async fn insert_and_fetch_run() {
    let db = Db::open_memory().await.expect("open memory db");
    let id = "01900000-0000-7000-8000-000000000001".to_string();

    let rec = RunRecord {
        id: id.clone(),
        prompt: "hello".into(),
        cwd: "/tmp".into(),
        args_json: "[]".into(),
        state: RunState::Queued,
        enqueued_at: Utc::now().timestamp_millis(),
        started_at: None,
        ended_at: None,
        stop_reason: None,
        error: None,
    };

    db.insert_run(&rec).await.expect("insert");
    let got = db.fetch_run(&id).await.expect("fetch").expect("not none");
    assert_eq!(got.prompt, "hello");
    assert!(matches!(got.state, RunState::Queued));
}

#[tokio::test]
async fn update_state_persists() {
    let db = Db::open_memory().await.unwrap();
    let id = "01900000-0000-7000-8000-000000000002".to_string();
    let rec = RunRecord {
        id: id.clone(),
        prompt: "p".into(),
        cwd: "/tmp".into(),
        args_json: "[]".into(),
        state: RunState::Queued,
        enqueued_at: Utc::now().timestamp_millis(),
        started_at: None, ended_at: None, stop_reason: None, error: None,
    };
    db.insert_run(&rec).await.unwrap();

    db.update_state(&id, RunState::Running, Some(Utc::now().timestamp_millis()), None, None, None)
        .await
        .unwrap();

    let got = db.fetch_run(&id).await.unwrap().unwrap();
    assert!(matches!(got.state, RunState::Running));
    assert!(got.started_at.is_some());
}

#[tokio::test]
async fn vacuum_drops_old_finished_runs() {
    let db = Db::open_memory().await.unwrap();
    let week_ms = 7 * 24 * 60 * 60 * 1000;
    let old = Utc::now().timestamp_millis() - week_ms - 1000;
    let new = Utc::now().timestamp_millis();

    for (id, ended) in [("old", old), ("new", new)] {
        db.insert_run(&RunRecord {
            id: id.into(), prompt: "p".into(), cwd: "/tmp".into(), args_json: "[]".into(),
            state: RunState::Done, enqueued_at: ended, started_at: Some(ended), ended_at: Some(ended),
            stop_reason: Some("EndTurn".into()), error: None,
        }).await.unwrap();
    }

    let removed = db.vacuum(week_ms).await.unwrap();
    assert_eq!(removed, 1);
    assert!(db.fetch_run("old").await.unwrap().is_none());
    assert!(db.fetch_run("new").await.unwrap().is_some());
}
