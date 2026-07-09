// Toast for destructive actions: message + inline Undo button. Rendered in
// the conversation panel next to the session-notice toast; state machinery
// lives in hooks/useUndoToast.ts.
import type { UndoToastState } from '../hooks/useUndoToast';
import { t } from '../i18n';

interface Props {
  toast: UndoToastState | null;
  onUndo: () => void;
}

export function UndoToast({ toast, onUndo }: Props) {
  if (!toast) return null;
  return (
    <div className="session-toast undo-toast" role="status">
      <span>{toast.text}</span>
      <button className="undo-toast-action" type="button" onClick={onUndo}>
        {t('common.undo')}
      </button>
    </div>
  );
}
