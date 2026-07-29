import { useCallback, useEffect, useRef, useState } from 'react';
import {
  makeStyles,
  mergeClasses,
  tokens,
  Text,
  Textarea,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
  Avatar,
} from '@fluentui/react-components';
import { Send24Regular, Sparkle24Filled, Person24Regular } from '@fluentui/react-icons';

import { useAuth } from '@/hooks/useAuth';
import { askOneLens, connectAskOneLens } from '@/services/askOneLens';
import { PageHeader } from '@/components/PageHeader';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
}

const STARTER_QUESTIONS = [
  'How many items are fully governed, and what is the ownership coverage percentage?',
  'Which workspace has the most items?',
  'What items are stale and have not been modified in over 90 days?',
  'How has documentation coverage changed over time?',
];

const useStyles = makeStyles({
  root: { height: '100%', display: 'flex', flexDirection: 'column' },
  header: {
    padding: '20px 32px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headTitle: { display: 'flex', alignItems: 'center', gap: '10px' },
  body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', maxWidth: '860px', width: '100%', margin: '0 auto', padding: '0 32px' },
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 0', display: 'flex', flexDirection: 'column', gap: '16px' },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', textAlign: 'center' },
  emptyIcon: { color: tokens.colorBrandForeground1 },
  starterGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', width: '100%', maxWidth: '640px' },
  starterCard: {
    padding: '12px 14px',
    textAlign: 'left',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    ':disabled': { cursor: 'not-allowed', opacity: 0.5 },
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover, border: `1px solid ${tokens.colorBrandStroke1}` },
  },
  turn: { display: 'flex', gap: '12px', alignItems: 'flex-start' },
  bubble: {
    padding: '10px 14px',
    borderRadius: tokens.borderRadiusLarge,
    maxWidth: '640px',
    fontSize: tokens.fontSizeBase300,
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
  },
  bubbleAssistant: { backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke2}` },
  bubbleUser: { backgroundColor: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1 },
  bubbleError: { backgroundColor: tokens.colorPaletteRedBackground1, border: `1px solid ${tokens.colorPaletteRedBorder1}` },
  composer: {
    padding: '16px 0 24px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-end',
  },
  textarea: { flex: 1 },
  hint: { padding: '8px 32px 0', color: tokens.colorNeutralForeground3 },
});

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AskOneLensPage() {
  const styles = useStyles();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Silent-only check on mount (never opens a popup, so this always
    // resolves quickly). If it comes back false, that's normal for a first
    // visit — the first real "Ask" click will complete sign-in interactively,
    // since that's a genuine user gesture and popups are only allowed there.
    let cancelled = false;
    connectAskOneLens()
      .catch(() => false)
      .finally(() => {
        if (!cancelled) setCheckingConnection(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || sending) return;

      setDraft('');
      setMessages((prev) => [...prev, { id: newId(), role: 'user', text }]);
      setSending(true);
      try {
        const answer = await askOneLens(text, user?.email);
        setMessages((prev) => [...prev, { id: newId(), role: 'assistant', text: answer }]);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ask OneLens could not answer that question.';
        setMessages((prev) => [...prev, { id: newId(), role: 'assistant', text: message, error: true }]);
      } finally {
        setSending(false);
      }
    },
    [sending, user?.email]
  );

  const busy = sending;

  return (
    <div className={styles.root}>
      <PageHeader
        icon={<Sparkle24Filled />}
        title="Ask OneLens"
        subtitle="Ask natural-language questions about your governance catalog — coverage, lineage, posture, and more."
      />

      <div className={styles.body}>
        <div
          className={styles.scroll}
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Ask OneLens conversation"
        >
          {messages.length === 0 ? (
            <div className={styles.empty}>
              <Sparkle24Filled fontSize={40} className={styles.emptyIcon} />
              <Text size={400} weight="semibold">
                Ask anything about your Fabric tenant's governance
              </Text>
              {checkingConnection && <Spinner size="tiny" label="Checking connection…" labelPosition="after" />}
              <div className={styles.starterGrid}>
                {STARTER_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className={styles.starterCard}
                    onClick={() => void send(q)}
                    disabled={busy}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={styles.turn} aria-label={`${m.role === 'user' ? 'You' : 'Ask OneLens'}: ${m.text}`}>
                <Avatar
                  icon={m.role === 'user' ? <Person24Regular /> : <Sparkle24Filled />}
                  color={m.role === 'user' ? 'colorful' : 'brand'}
                  size={28}
                />
                <div
                  className={mergeClasses(
                    styles.bubble,
                    m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
                    m.error && styles.bubbleError
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))
          )}
          {sending && (
            <div className={styles.turn}>
              <Avatar icon={<Sparkle24Filled />} color="brand" size={28} />
              <Spinner size="tiny" label="Thinking…" labelPosition="after" />
            </div>
          )}
        </div>

        <MessageBar intent="info" style={{ marginBottom: '8px' }}>
          <MessageBarBody>
            Answers are generated from the Governance OneLens Model and may be approximate — always verify important decisions in the underlying catalog.
          </MessageBarBody>
        </MessageBar>

        <div className={styles.composer}>
          <Textarea
            className={styles.textarea}
            aria-label="Ask OneLens question"
            placeholder="Ask about coverage, lineage, stale items, workspaces…"
            value={draft}
            resize="vertical"
            onChange={(_, data) => setDraft(data.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            disabled={busy}
          />
          <Button appearance="primary" icon={<Send24Regular />} onClick={() => void send(draft)} disabled={busy || !draft.trim()}>
            Ask
          </Button>
        </div>
      </div>
    </div>
  );
}
