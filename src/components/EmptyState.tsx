// The zero-message empty state: heading, starter-prompt cards, and the
// keyboard hint. Extracted from App.tsx unchanged.
import { Bot } from "lucide-react";

export interface EmptyStateProps {
  activeModel: string;
  onPickStarter: (prompt: string) => void;
}

export function EmptyState({ activeModel, onPickStarter }: EmptyStateProps) {
  return (
                <div className="empty-state">
                  <div className="empty-state-head">
                    <div className="empty-state-avatar"><Bot size={22} /></div>
                    <h2 className="empty-state-title">How can Grok help today?</h2>
                    <p className="empty-state-subtitle">
                      Code with you across this repository · {activeModel}
                    </p>
                  </div>
                  <div className="starter-grid">
                    {[
                      {
                        title: "Review this repository",
                        body: "Surface the highest-impact risks and gaps you can verify in 30 seconds.",
                        prompt:
                          "Review this repository like a senior engineer. Surface the top 3 risks or gaps you can verify in under a minute, with one exact command per finding.",
                      },
                      {
                        title: "Explain this codebase",
                        body: "Give me a tight architecture tour so I can start contributing today.",
                        prompt:
                          "Give me a 5-bullet architecture tour of this repository: entry point, key modules, build/run command, test command, and one gotcha. Be concrete.",
                      },
                      {
                        title: "Add a failing test",
                        body: "Pick a real bug or gap and write a failing test that pins it down.",
                        prompt:
                          "Find one real bug, edge case, or gap in this repository. Write a failing test that pins it down. Tell me the file path and the exact command to run just that test.",
                      },
                      {
                        title: "Suggest the next change",
                        body: "What is the single most useful next code action right now?",
                        prompt:
                          "What is the single most useful next code action in this repository right now? Show the proposed diff and the verification command. Be specific.",
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
                    Press <kbd>↵</kbd> to send · <kbd>⇧↵</kbd> newline · <kbd>⌘1</kbd>/<kbd>⌘2</kbd> to switch modes
                  </p>
                </div>
  );
}
