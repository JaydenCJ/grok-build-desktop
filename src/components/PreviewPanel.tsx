// The generated-static-site preview drawer (iframe + file strip).
// Extracted from App.tsx unchanged.
import { FileText, Globe2, Loader2, RefreshCcw, X } from "lucide-react";
import type { StaticPreview } from "../app/types";

export interface PreviewPanelProps {
  open: boolean;
  onClose: () => void;
  staticPreview: StaticPreview | null;
  previewBusy: boolean;
  onRefresh: () => void;
}

export function PreviewPanel({
  open,
  onClose,
  staticPreview,
  previewBusy,
  onRefresh,
}: PreviewPanelProps) {
  const previewFiles = staticPreview?.files ?? [];
  const previewReady = Boolean(staticPreview?.available && staticPreview.previewUrl);
  const previewEntry = staticPreview?.entryPath
    ? staticPreview.entryPath.split("/").pop() || "index.html"
    : "index.html";
  return (
          <aside
            aria-hidden={!open}
            className={`preview-panel preview-drawer ${open ? "open" : ""}`}
            aria-label="Generated preview"
          >
            <div className="preview-head">
              <div>
                <Globe2 size={16} />
                <strong>Preview</strong>
                <span>{previewReady ? previewEntry : "waiting for index.html"}</span>
              </div>
              <div className="preview-actions">
                <button
                  aria-label="Refresh preview"
                  disabled={previewBusy}
                  onClick={() => onRefresh()}
                  type="button"
                >
                  {previewBusy ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                </button>
                <button aria-label="Close preview" onClick={onClose} type="button">
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="preview-frame-wrap">
              {previewReady ? (
                // The src points at the token-gated grokpreview:// custom
                // protocol: the served document carries its own CSP instead of
                // inheriting the strict app CSP (which an about:srcdoc
                // document would), and the sandbox (which deliberately omits
                // the same-origin flag) keeps it an opaque origin with no
                // Tauri IPC access.
                <iframe
                  sandbox="allow-forms allow-popups allow-scripts"
                  src={staticPreview?.previewUrl}
                  title="Generated static site preview"
                />
              ) : (
                <div className="preview-empty">
                  <FileText size={22} />
                  <strong>No static preview yet</strong>
                  <span>{staticPreview?.detail ?? "Ask Grok to create index.html, then the result appears here."}</span>
                </div>
              )}
            </div>
            <div className="preview-files">
              {previewFiles.length > 0 ? (
                previewFiles.slice(0, 6).map((file) => (
                  <span key={file.path}>
                    <FileText size={13} />
                    <span>{file.name}</span>
                    <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
                  </span>
                ))
              ) : (
                <span>
                  <FileText size={13} />
                  <span>No files in project root</span>
                </span>
              )}
            </div>
          </aside>
  );
}
