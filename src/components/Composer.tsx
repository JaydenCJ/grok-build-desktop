import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { enqueueRun } from '../lib/grok';
import { useActiveRun } from '../hooks/useActiveRun';
import { useQueue } from '../hooks/useQueue';
import {
  notePendingSubmitEnd,
  notePendingSubmitStart,
} from '../lib/streamStore';

export interface ComposerHandle {
  /** Imperatively set the textarea value (used by starter cards / history click / drafts). */
  setValue: (text: string) => void;
  /** Current textarea value. */
  getValue: () => string;
  /** Focus the textarea. */
  focus: () => void;
}

interface Props {
  cwd: string;
  argsBuilder: () => string[];
  /** Optional wrapper called once before sending — used to add a coding-mode preamble etc. */
  promptWrapper?: (raw: string) => string;
  /** Initial seed value (e.g. restored from session_state drafts). Only applied once on mount. */
  initialValue?: string;
  placeholder?: string;
  onEnqueued?: (info: {
    runId: string;
    position: number;
    prompt: string;
    rawText: string;
  }) => void;
  /**
   * Optional draft-persistence callback. **Called only on blur and on unmount**,
   * not on every keystroke — passing it as a per-keystroke listener would force
   * the parent (3000-line App.tsx) to re-render on each character and stall the
   * main thread, which in turn drops IME composition events and causes
   * accidental auto-submits. We persist on blur instead, which is enough for
   * "user typed, switched modes" preservation.
   */
  onTextChange?: (text: string) => void;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    cwd,
    argsBuilder,
    promptWrapper,
    initialValue,
    placeholder,
    onEnqueued,
    onTextChange,
  }: Props,
  outerRef,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Track composition via BOTH a ref (sync, immune to React lag) and React
  // state (drives Send/Queuing label re-render). The ref is the authoritative
  // guard inside the keydown handler.
  const composingRef = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  const active = useActiveRun();
  const queue = useQueue();

  useImperativeHandle(
    outerRef,
    () => ({
      setValue: (text: string) => {
        const el = ref.current;
        if (!el) return;
        el.value = text;
      },
      getValue: () => ref.current?.value ?? '',
      focus: () => ref.current?.focus(),
    }),
    [],
  );

  // Apply initialValue once on mount.
  useEffect(() => {
    if (initialValue && ref.current && !ref.current.value) {
      ref.current.value = initialValue;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the in-flight draft on unmount (e.g. parent re-mounts Composer on
  // mode switch). Reads the current text directly from the DOM ref — no
  // dependency on React state.
  useEffect(() => {
    return () => {
      const text = ref.current?.value ?? '';
      if (text && onTextChangeRef.current) onTextChangeRef.current(text);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasInflight =
    Boolean(active && active.state === 'running') || queue.items.length > 0;

  const submit = async () => {
    if (submitting) return;
    const el = ref.current;
    if (!el) return;
    const rawText = el.value.trim();
    if (!rawText) return;
    setSubmitting(true);
    notePendingSubmitStart();
    try {
      const wrapped = promptWrapper ? promptWrapper(rawText) : rawText;
      const args = argsBuilder();
      args.push('-p', wrapped);
      const result = await enqueueRun({ prompt: wrapped, cwd, args });
      el.value = '';
      onTextChangeRef.current?.('');
      onEnqueued?.({
        runId: result.runId,
        position: result.position,
        prompt: wrapped,
        rawText,
      });
    } catch (err) {
      console.error('[grok-desktop] enqueue failed', err);
    } finally {
      notePendingSubmitEnd();
      setSubmitting(false);
    }
  };

  return (
    <div className={`composer${submitting ? ' composer-submitting' : ''}`}>
      <textarea
        ref={ref}
        disabled={submitting}
        placeholder={
          submitting
            ? 'Queuing your prompt…'
            : placeholder ?? (hasInflight ? 'Queue another prompt…' : 'Ask Grok…')
        }
        onCompositionStart={() => {
          composingRef.current = true;
          setIsComposing(true);
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          setIsComposing(false);
        }}
        onBlur={(e) => {
          // Persist draft only on blur, not every keystroke — that's the
          // critical perf invariant. See header comment on onTextChange prop.
          onTextChangeRef.current?.((e.target as HTMLTextAreaElement).value);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return;
          // Four-layer guard against accidental Enter-during-IME auto-submit:
          //   1. composingRef.current — sync ref, set synchronously by
          //      onCompositionStart even when React is busy
          //   2. React isComposing state — same signal but visible to children
          //   3. native.isComposing — browser-level flag, immune to React lag
          //   4. keyCode 229 — some browsers fire Enter as 229 mid-composition
          // Any one means "do not submit".
          const native = e.nativeEvent as KeyboardEvent;
          if (
            composingRef.current ||
            isComposing ||
            native.isComposing ||
            native.keyCode === 229
          ) {
            return;
          }
          e.preventDefault();
          void submit();
        }}
      />
      <button
        className="composer-send"
        disabled={submitting}
        onClick={() => void submit()}
      >
        {submitting ? 'Queuing…' : hasInflight ? 'Enqueue' : 'Send'}
      </button>
    </div>
  );
});
