import type { ConversationView } from '../../shared/api.js';

interface SidebarProps {
  conversations: ConversationView[];
  selectedId: string | null;
  busy: boolean;
  onSelect(id: string): void;
  onCreate(): void;
}

function label(conversation: ConversationView): string {
  if (conversation.title?.trim()) return conversation.title;
  return `Conversation · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(conversation.createdAt))}`;
}

export function Sidebar({ conversations, selectedId, busy, onSelect, onCreate }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Conversations">
      <div className="sidebar-heading">
        <a className="brand" href="/" aria-label="Minimi agent home">Minimi</a>
        <button className="new-chat" type="button" onClick={onCreate} disabled={busy}>New chat</button>
      </div>
      <nav aria-label="Saved conversations">
        {conversations.length === 0 && <p className="empty-note">Your conversations will appear here.</p>}
        <ul className="conversation-list">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                className={`conversation-link${selectedId === conversation.id ? ' selected' : ''}`}
                aria-current={selectedId === conversation.id ? 'page' : undefined}
                onClick={() => onSelect(conversation.id)}
              >
                <span>{label(conversation)}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <p className="sidebar-foot">Saved locally on this device</p>
    </aside>
  );
}
