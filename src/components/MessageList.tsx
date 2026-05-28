import { Virtuoso } from 'react-virtuoso';
import { MessageItem } from './MessageItem';

export interface MessageRef {
  runId: string;
  role: 'user' | 'assistant';
  userText?: string;
}

interface Props {
  messages: MessageRef[];
}

export function MessageList({ messages }: Props) {
  return (
    <Virtuoso
      data={messages}
      followOutput="auto"
      style={{ height: '100%' }}
      increaseViewportBy={{ top: 200, bottom: 400 }}
      itemContent={(_, msg) => {
        if (msg.role === 'user') {
          return (
            <div className="message message-user">
              <pre className="message-body">{msg.userText}</pre>
            </div>
          );
        }
        return (
          <div className="message message-assistant">
            <MessageItem runId={msg.runId} />
          </div>
        );
      }}
    />
  );
}
