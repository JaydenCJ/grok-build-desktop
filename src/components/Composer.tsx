import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { enqueueRun } from '../lib/grok';
import { useHasInflight } from '../hooks/useActiveRun';
import {
  notePendingSubmitEnd,
  notePendingSubmitStart,
} from '../lib/streamStore';
import { extractFileMentions, readFileSafe, type FileEntry } from '../lib/files';
import { FilePicker } from './FilePicker';
import { t } from '../i18n';

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
  /** Initial seed value (e.g. restored from session_state drafts). Only applied once on mount. */
  initialValue?: string;
  placeholder?: string;
  onEnqueued?: (info: {
    runId: string;
    position: number;
    prompt: string;
    rawText: string;
  }) => void;
  /** Called when enqueueing the prompt fails, with a human-readable message.
   *  The host surfaces it (session notice) — a silent console.error left the
   *  user staring at a composer that "ate" their prompt. */
  onError?: (message: string) => void;
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

/**
 * Find the active `@token` immediately to the left of the textarea caret. If
 * the caret is not inside an unfinished `@…` mention, returns null. The token
 * begins right after the most recent `@` that follows whitespace or
 * string-start, and runs until the caret. Whitespace inside the token closes
 * it (the user finished typing the filename).
 */
function detectActiveMention(text: string, caret: number): { start: number; query: string } | null {
  if (caret <= 0) return null;
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') {
      // valid only if @ is at string-start or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1]!)) {
        return { start: i, query: text.slice(i + 1, caret) };
      }
      return null;
    }
    if (/\s/.test(ch ?? '')) return null;
    i--;
  }
  return null;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    cwd,
    argsBuilder,
    initialValue,
    placeholder,
    onEnqueued,
    onError,
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
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  // Primitive selector — subscribing to whole run/queue snapshots would
  // re-render the Composer on every streamed token (see useHasInflight).
  const hasInflight = useHasInflight();

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
    const node = ref.current;
    return () => {
      const text = node?.value ?? '';
      if (text && onTextChangeRef.current) onTextChangeRef.current(text);
    };
  }, []);

  /**
   * Re-scan the textarea for an active @mention. Called on input + caret
   * movement. We can't use a controlled value because the textarea is
   * uncontrolled (perf invariant — see onTextChange comment).
   */
  const refreshMention = () => {
    const el = ref.current;
    if (!el) {
      setMention(null);
      return;
    }
    const caret = el.selectionStart ?? 0;
    setMention(detectActiveMention(el.value, caret));
  };

  const insertMention = (entry: FileEntry) => {
    const el = ref.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? 0;
    const before = el.value.slice(0, mention.start);
    const after = el.value.slice(caret);
    // Quote paths containing whitespace so extractFileMentions can parse them
    // back out as one token ("My Project/notes.md" would otherwise become @My).
    const insertion = /\s/.test(entry.path) ? `@"${entry.path}" ` : `@${entry.path} `;
    el.value = `${before}${insertion}${after}`;
    const newCaret = before.length + insertion.length;
    el.setSelectionRange(newCaret, newCaret);
    setMention(null);
    el.focus();
  };

  /**
   * Resolve `@path` mentions in the raw prompt: read each file (size-capped)
   * and append the contents as a fenced context block at the end. The model
   * sees the original prompt verbatim (mentions remain inline) plus a
   * "Referenced files" section with the actual content.
   */
  const expandMentionsInPrompt = async (raw: string): Promise<string> => {
    const mentions = extractFileMentions(raw);
    if (mentions.length === 0 || !cwd.trim()) return raw;
    const blocks: string[] = [];
    for (const mentionPath of mentions) {
      const body = await readFileSafe(cwd, mentionPath, 200_000);
      if (body == null) {
        blocks.push(`\n### @${mentionPath}\n_(file unreadable, too large, or binary — skipped)_`);
      } else {
        const ext = mentionPath.includes('.') ? mentionPath.split('.').pop() : '';
        blocks.push(`\n### @${mentionPath}\n\`\`\`${ext ?? ''}\n${body}\n\`\`\``);
      }
    }
    return `${raw}\n\n---\nReferenced files (from @ mentions):${blocks.join('\n')}`;
  };

  const submit = async () => {
    if (submitting) return;
    const el = ref.current;
    if (!el) return;
    const rawText = el.value.trim();
    if (!rawText) return;
    setSubmitting(true);
    setMention(null);
    notePendingSubmitStart();
    try {
      const prompt = await expandMentionsInPrompt(rawText);
      const args = argsBuilder();
      args.push('-p', prompt);
      const result = await enqueueRun({ prompt, cwd, args });
      el.value = '';
      onTextChangeRef.current?.('');
      onEnqueued?.({
        runId: result.runId,
        position: result.position,
        prompt,
        rawText,
      });
    } catch (err) {
      console.error('[grok-desktop] enqueue failed', err);
      // Surface the failure — the prompt is still in the textarea, so the
      // user can retry once the cause (e.g. backend not ready) is fixed.
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      notePendingSubmitEnd();
      setSubmitting(false);
      // Disabling the textarea during submit blurs it; restore focus so the
      // type→Enter→type flow survives every send. rAF lets the re-enable
      // render commit first.
      requestAnimationFrame(() => ref.current?.focus());
    }
  };

  return (
    <div className={`composer${submitting ? ' composer-submitting' : ''}`}>
      {mention && cwd.trim() ? (
        <FilePicker
          cwd={cwd}
          query={mention.query}
          onSelect={insertMention}
          onCancel={() => setMention(null)}
        />
      ) : null}
      <textarea
        ref={ref}
        disabled={submitting}
        placeholder={
          submitting
            ? t('composer.placeholderQueuing')
            : placeholder ??
              (hasInflight ? t('composer.placeholderQueueAnother') : t('composer.placeholderAsk'))
        }
        onCompositionStart={() => {
          composingRef.current = true;
          setIsComposing(true);
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          setIsComposing(false);
          refreshMention();
        }}
        onInput={() => refreshMention()}
        onClick={() => refreshMention()}
        onKeyUp={(e) => {
          // arrow-nav over the textarea moves the caret too — refresh after.
          if (
            e.key === 'ArrowLeft' ||
            e.key === 'ArrowRight' ||
            e.key === 'ArrowUp' ||
            e.key === 'ArrowDown' ||
            e.key === 'Home' ||
            e.key === 'End'
          ) {
            refreshMention();
          }
        }}
        onBlur={(e) => {
          // Persist draft only on blur, not every keystroke — that's the
          // critical perf invariant. See header comment on onTextChange prop.
          onTextChangeRef.current?.((e.target as HTMLTextAreaElement).value);
          // Close mention picker on blur so it doesn't linger over other UI.
          // Use a microtask so mousedown on a picker row can fire first.
          setTimeout(() => setMention(null), 100);
        }}
        onKeyDown={(e) => {
          // When the file picker is open it owns Enter/Tab/Arrows/Esc. Mirror
          // the render condition below (`mention && cwd.trim()`): with no cwd
          // the picker never shows, so a trailing @word must not swallow Enter.
          if (mention && cwd.trim()) {
            const navKeys = ['Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'Escape'];
            if (navKeys.includes(e.key)) return;
          }
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
        {submitting ? t('composer.sendQueuing') : hasInflight ? t('composer.sendEnqueue') : t('composer.send')}
      </button>
    </div>
  );
});
