import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { enqueueRun } from '../lib/grok';
import { useActiveRun } from '../hooks/useActiveRun';
import { useQueue } from '../hooks/useQueue';

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
  onEnqueued?: (info: { runId: string; position: number; prompt: string; rawText: string }) => void;
  /** Called on each keystroke so parent can persist drafts. */
  onTextChange?: (text: string) => void;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { cwd, argsBuilder, promptWrapper, initialValue, placeholder, onEnqueued, onTextChange }: Props,
  outerRef,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const active = useActiveRun();
  const queue = useQueue();

  useImperativeHandle(outerRef, () => ({
    setValue: (text: string) => {
      const el = ref.current;
      if (!el) return;
      el.value = text;
      onTextChange?.(text);
    },
    getValue: () => ref.current?.value ?? '',
    focus: () => ref.current?.focus(),
  }), [onTextChange]);

  // Apply initialValue once on mount.
  useEffect(() => {
    if (initialValue && ref.current && !ref.current.value) {
      ref.current.value = initialValue;
    }
    // We deliberately do not depend on initialValue past mount — it's a seed, not a controlled prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasInflight = Boolean(active && active.state === 'running') || queue.items.length > 0;

  const submit = async () => {
    const el = ref.current;
    if (!el) return;
    const rawText = el.value.trim();
    if (!rawText) return;
    const wrapped = promptWrapper ? promptWrapper(rawText) : rawText;
    const args = argsBuilder();
    args.push('-p', wrapped);
    const result = await enqueueRun({ prompt: wrapped, cwd, args });
    el.value = '';
    onTextChange?.('');
    onEnqueued?.({ runId: result.runId, position: result.position, prompt: wrapped, rawText });
  };

  return (
    <div className="composer">
      <textarea
        ref={ref}
        placeholder={placeholder ?? (hasInflight ? 'Queue another prompt…' : 'Ask Grok…')}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onInput={(e) => onTextChange?.((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <button className="composer-send" onClick={() => void submit()}>
        {hasInflight ? 'Enqueue' : 'Send'}
      </button>
    </div>
  );
});
