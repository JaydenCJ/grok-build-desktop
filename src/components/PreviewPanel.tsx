// The generated-static-site preview drawer (iframe + file strip).
// Extracted from App.tsx unchanged.
import { FileText, Globe2, Loader2, RefreshCcw, X } from "lucide-react";
import type { StaticPreview } from "../app/types";
import { t } from "../i18n";

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
            aria-label={t('preview.ariaLabel')}
          >
            <div className="preview-head">
              <div>
                <Globe2 size={16} />
                <strong>{t('preview.title')}</strong>
                <span>{previewReady ? previewEntry : t('preview.waiting')}</span>
              </div>
              <div className="preview-actions">
                <button
                  aria-label={t('preview.refresh')}
                  disabled={previewBusy}
                  onClick={() => onRefresh()}
                  type="button"
                >
                  {previewBusy ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                </button>
                <button aria-label={t('preview.close')} onClick={onClose} type="button">
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
                  title={t('preview.iframeTitle')}
                />
              ) : (
                <div className="preview-empty">
                  <FileText size={22} />
                  <strong>{t('preview.emptyTitle')}</strong>
                  <span>{staticPreview?.detail ?? t('preview.emptyHint')}</span>
                </div>
              )}
            </div>
            <div className="preview-files">
              {previewFiles.length > 0 ? (
                previewFiles.slice(0, 6).map((file) => (
                  <span key={file.path}>
                    <FileText size={13} />
                    <span>{file.name}</span>
                    <small>{t('preview.fileSize', { size: Math.max(1, Math.round(file.size / 1024)) })}</small>
                  </span>
                ))
              ) : (
                <span>
                  <FileText size={13} />
                  <span>{t('preview.noFiles')}</span>
                </span>
              )}
            </div>
          </aside>
  );
}
