// The preview:// protocol serves the generated-site document with its own
// permissive CSP so scripts run inside the sandboxed Preview iframe while the
// app document keeps its strict CSP. These tests pin the response contract
// without needing a GUI.
use grok_desktop_lib::preview_protocol_response;

#[test]
fn preview_response_carries_own_permissive_csp() {
    let resp = preview_protocol_response(Some(
        "<html><body><script>document.title='ok'</script></body></html>".into(),
    ));
    assert_eq!(resp.status(), 200);

    let csp = resp
        .headers()
        .get("Content-Security-Policy")
        .expect("preview response must carry its own CSP")
        .to_str()
        .unwrap();
    // Inline scripts must be allowed — generated previews are single-file
    // pages with inline <script>, and the backend deliberately inlines local
    // JS into the document.
    assert!(csp.contains("'unsafe-inline'"), "csp was: {csp}");

    let content_type = resp
        .headers()
        .get("Content-Type")
        .expect("content type required")
        .to_str()
        .unwrap();
    assert!(content_type.starts_with("text/html"));

    // No caching — the document is replaced on every preview refresh.
    assert_eq!(
        resp.headers().get("Cache-Control").unwrap().to_str().unwrap(),
        "no-store"
    );
    assert!(!resp.body().is_empty());
}

#[test]
fn preview_response_is_404_without_a_document() {
    for missing in [None, Some(String::new()), Some("   ".to_string())] {
        let resp = preview_protocol_response(missing);
        assert_eq!(resp.status(), 404);
    }
}
