// The zero-message empty state: heading, starter-prompt cards, and the
// keyboard hint. Extracted from App.tsx unchanged.
import { Bot } from 'lucide-react';
import { t } from '../i18n';

export interface EmptyStateProps {
  activeModel: string;
  onPickStarter: (prompt: string) => void;
}

export function EmptyState({ activeModel, onPickStarter }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-head">
        <div className="empty-state-avatar">
          <Bot size={22} />
        </div>
        <h2 className="empty-state-title">{t('emptyState.title')}</h2>
        <p className="empty-state-subtitle">{t('emptyState.subtitle', { model: activeModel })}</p>
      </div>
      <div className="starter-grid">
        {/* Card `prompt` bodies are model-facing prompt text — hardcoded by design. */}
        {[
          {
            title: t('emptyState.reviewTitle'),
            body: t('emptyState.reviewBody'),
            prompt:
              'Review this repository like a senior engineer. Surface the top 3 risks or gaps you can verify in under a minute, with one exact command per finding.',
          },
          {
            title: t('emptyState.explainTitle'),
            body: t('emptyState.explainBody'),
            prompt:
              'Give me a 5-bullet architecture tour of this repository: entry point, key modules, build/run command, test command, and one gotcha. Be concrete.',
          },
          {
            title: t('emptyState.testTitle'),
            body: t('emptyState.testBody'),
            prompt:
              'Find one real bug, edge case, or gap in this repository. Write a failing test that pins it down. Tell me the file path and the exact command to run just that test.',
          },
          {
            title: t('emptyState.nextTitle'),
            body: t('emptyState.nextBody'),
            prompt:
              'What is the single most useful next code action in this repository right now? Show the proposed diff and the verification command. Be specific.',
          },
        ].map((card) => (
          <button
            key={card.title}
            className="starter-card"
            onClick={() => onPickStarter(card.prompt)}
            type="button"
          >
            <strong>{card.title}</strong>
            <span>{card.body}</span>
          </button>
        ))}
      </div>
      <p className="empty-state-hint">
        Press <kbd>↵</kbd> to send · <kbd>⇧↵</kbd> newline · <kbd>⌘1</kbd>/<kbd>⌘2</kbd> to switch
        modes
      </p>
    </div>
  );
}
