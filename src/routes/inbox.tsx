import * as React from 'react';
import { useSearchParams } from 'react-router';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';

const palette = {
  ink: '#0c1b1a',
  mint: '#9ae6b4',
  sea: '#0f766e',
  sunrise: '#ffb347',
  sand: '#f8f5f2',
  slate: '#284b63',
  cloud: '#f2f4f8',
  coral: '#f97068',
};

const styles = stylex.create({
  wrapper: {
    display: 'grid',
    gap: '16px',
  },
  topBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    alignItems: 'center',
    padding: '12px',
    borderRadius: '14px',
    border: '1px solid rgba(12, 27, 26, 0.1)',
    backgroundColor: '#ffffff',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  filtersGroup: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  select: {
    padding: '6px 10px',
    borderRadius: '10px',
    border: '1px solid rgba(12, 27, 26, 0.15)',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  input: {
    padding: '8px 12px',
    borderRadius: '10px',
    border: '1px solid rgba(12, 27, 26, 0.15)',
    minWidth: '220px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  panels: {
    display: 'grid',
    gridTemplateColumns: '320px minmax(0, 1fr)',
    gap: '16px',
  },
  list: {
    borderRadius: '16px',
    border: '1px solid rgba(12, 27, 26, 0.1)',
    backgroundColor: '#ffffff',
    padding: '12px',
    display: 'grid',
    gap: '10px',
    maxHeight: '70vh',
    overflow: 'auto',
  },
  listItem: {
    borderRadius: '12px',
    border: '1px solid rgba(12, 27, 26, 0.08)',
    padding: '10px',
    display: 'grid',
    gap: '6px',
    cursor: 'pointer',
  },
  listItemActive: {
    borderColor: palette.sea,
    boxShadow: '0 10px 24px rgba(15, 118, 110, 0.12)',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px',
    borderRadius: '999px',
    backgroundColor: palette.cloud,
    color: palette.ink,
    fontSize: '11px',
    fontWeight: 600,
  },
  badgeSecondary: {
    backgroundColor: '#fff4d6',
    color: '#7c3e00',
  },
  mainPanel: {
    borderRadius: '16px',
    border: '1px solid rgba(12, 27, 26, 0.1)',
    backgroundColor: '#ffffff',
    padding: '16px',
    display: 'grid',
    gap: '16px',
    maxHeight: '70vh',
    overflow: 'auto',
  },
  appReview: {
    borderRadius: '14px',
    border: '1px dashed rgba(15, 118, 110, 0.4)',
    padding: '12px 14px',
    backgroundColor: '#f2fbf9',
    display: 'grid',
    gap: '8px',
  },
  timeline: {
    display: 'grid',
    gap: '10px',
  },
  message: {
    borderRadius: '12px',
    padding: '10px 12px',
    border: '1px solid rgba(12, 27, 26, 0.08)',
    maxWidth: '80%',
  },
  inbound: {
    backgroundColor: '#f8f5f2',
    justifySelf: 'start',
  },
  outbound: {
    backgroundColor: '#e7f7f2',
    justifySelf: 'end',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '6px',
  },
  chip: {
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    backgroundColor: '#eef2ff',
    color: '#3730a3',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  sectionTitle: {
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontWeight: 600,
    fontSize: '13px',
    color: palette.slate,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  graph: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  node: {
    padding: '6px 10px',
    borderRadius: '999px',
    border: '1px solid rgba(12, 27, 26, 0.1)',
    backgroundColor: '#ffffff',
    fontSize: '12px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  nodeActive: {
    backgroundColor: palette.mint,
  },
  divider: {
    height: '1px',
    backgroundColor: 'rgba(12, 27, 26, 0.08)',
  },
  composer: {
    display: 'grid',
    gap: '8px',
  },
  textarea: {
    width: '100%',
    minHeight: '90px',
    borderRadius: '12px',
    border: '1px solid rgba(12, 27, 26, 0.15)',
    padding: '10px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  actionsRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  liveIndicator: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: palette.slate,
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: palette.sea,
  },
});

type ConversationSummary = {
  id: string;
  channel: 'facebook' | 'instagram';
  assetId: string | null;
  assetName: string | null;
  participantName: string;
  participantHandle: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  lastSnippet: string | null;
  currentState: string;
  currentConfidence: string;
  followupSuggestion: string | null;
  followupDueAt: string | null;
};

type ConversationDetail = {
  conversation: ConversationSummary & {
    currentState: string;
    currentConfidence: string;
    followupSuggestion: string | null;
    followupDueAt: string | null;
    lastEvaluatedAt: string | null;
    offPlatformOutcome: string | null;
    finalTouchRequired: boolean;
    finalTouchSentAt: string | null;
    lostReasonCode: string | null;
  };
  messages: Array<{
    id: string;
    createdAt: string;
    body: string | null;
    direction: string | null;
    senderName: string | null;
    features: Record<string, unknown> | null;
    ruleHits: string[];
  }>;
  stateEvents: Array<{
    id: string;
    fromState: string | null;
    toState: string;
    confidence: string;
    reasons: Array<
      string | { code: string; confidence: string; evidence?: string | null }
    >;
    triggeredAt: string;
  }>;
};

type AiInterpretation = {
  handoff?: {
    is_handoff: boolean;
    type: string | null;
    confidence: string;
    evidence: string;
  };
  deferred?: {
    is_deferred: boolean;
    bucket: string | null;
    due_date_iso: string | null;
    confidence: string;
    evidence: string;
  };
};

type AiMeta = {
  input_hash?: string;
  mode?: string;
  model?: string;
  prompt_version?: string;
  interpretation?: AiInterpretation;
  skipped_reason?: string;
  errors?: string[];
  updated_at?: string;
};

type Template = {
  id: string;
  title: string;
  body: string;
  assetId: string | null;
};

type AssetsResponse = {
  pages: Array<{ id: string; name: string }>;
  igAssets: Array<{ id: string; name: string }>;
};

const stateTabs = [
  { key: 'needs_followup', label: 'Needs follow-up' },
  { key: 'DEFERRED', label: 'Deferred' },
  { key: 'OFF_PLATFORM', label: 'Off-platform' },
  { key: 'LOST', label: 'Lost' },
  { key: 'CONVERTED', label: 'Converted' },
];

const formatRelative = (value: string | null) => {
  if (!value) return '—';
  const diff = Date.now() - Date.parse(value);
  if (Number.isNaN(diff)) return value;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const ruleDescriptions: Record<string, string> = {
  SPAM_PHRASE: 'Spam or abuse language detected.',
  CONVERSION_PHRASE: 'Message indicates a conversion or completed sale.',
  LOSS_PHRASE: 'Message indicates a lost opportunity.',
  PHONE_OR_EMAIL: 'Phone or email exchanged (off-platform).',
  DEFERRAL_PHRASE: 'Customer asked to follow up later.',
  PRICE_MENTION: 'Pricing mentioned or currency detected.',
  SCHEDULE_MENTION: 'Scheduling or appointment intent detected.',
  OPT_OUT: 'Opt-out language detected.',
  LINK: 'Message contains a link.',
  UNREPLIED: 'Last inbound has not been answered.',
  SLA_BREACH: 'Inbound is older than the SLA threshold.',
  PRICE_STALE: 'Pricing was shared and follow-up stalled.',
  RESURRECTED: 'New inbound after a long inactivity gap.',
  USER_ANNOTATION: 'User annotation applied.',
  SYSTEM_ASSIGNMENT: 'System assignment message (not a conversion signal).',
  AI_HANDOFF_INTERPRET: 'AI inferred a handoff/off-platform intent.',
  AI_DEFER_INTERPRET: 'AI inferred a deferred follow-up request.',
  AI_HANDOFF: 'AI inferred off-platform handoff without explicit contact.',
  AI_DEFERRED: 'AI inferred deferred follow-up without explicit date.',
  ACK_ONLY: 'Polite acknowledgement (no new intent).',
  EXPLICIT_LOST_NOT_INTENTIONAL: 'Lost: contact was accidental.',
  EXPLICIT_LOST_BOUGHT_ELSEWHERE: 'Lost: bought elsewhere.',
  EXPLICIT_LOST_CHOSE_EXISTING: 'Lost: keeping existing item.',
  EXPLICIT_LOST_PRICE_OUT_OF_RANGE: 'Lost: price out of range.',
  EXPLICIT_LOST_EXPLICIT_DECLINE: 'Lost: explicit decline.',
  EXPLICIT_LOST_INDEFINITE_FUTURE: 'Lost: indefinite future.',
  EXPLICIT_LOST_TIMING_NOT_NOW: 'Lost: not the right time.',
  EXPLICIT_LOST_FEASIBILITY: 'Lost: not feasible for fit/space.',
  LOST_NOT_INTENTIONAL: 'Lost: contact was accidental.',
  LOST_BOUGHT_ELSEWHERE: 'Lost: bought elsewhere.',
  LOST_CHOSE_EXISTING: 'Lost: keeping existing item.',
  LOST_PRICE_OUT_OF_RANGE: 'Lost: price out of range.',
  LOST_EXPLICIT_DECLINE: 'Lost: explicit decline.',
  LOST_INDEFINITE_FUTURE: 'Lost: indefinite future.',
  LOST_INACTIVE_TIMEOUT: 'Lost: inactive for 30+ days.',
  LOST_TIMING_NOT_NOW: 'Lost: not the right time.',
  LOST_FEASIBILITY: 'Lost: not feasible for fit/space.',
  FINAL_TOUCH_SENT: 'Final courtesy message sent.',
};

const ruleLabels: Record<string, string> = {
  AI_HANDOFF_INTERPRET: 'Handoff (AI)',
  AI_DEFER_INTERPRET: 'Deferred (AI)',
};

const formatReason = (
  reason:
    | string
    | {
        code: string;
        confidence?: string;
        evidence?: string | null;
      },
) => {
  if (typeof reason === 'string') {
    return ruleDescriptions[reason] ?? reason;
  }
  const label = ruleDescriptions[reason.code] ?? reason.code;
  if (reason.evidence) {
    return `${label} — ${reason.evidence}`;
  }
  return label;
};

const getAiMeta = (features: Record<string, unknown> | null): AiMeta | null => {
  if (!features || typeof features !== 'object') return null;
  const ai = (features as { ai?: AiMeta }).ai;
  return ai ?? null;
};

const buildInboxWsUrl = () => {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss' : 'ws';
  return `${wsProtocol}://${host}/inbox/subscribe`;
};

export default function Inbox(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const [tab, setTab] = React.useState('needs_followup');
  const [showSpam, setShowSpam] = React.useState(false);
  const [channel, setChannel] = React.useState('all');
  const [assetId, setAssetId] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState('oldest');
  const [conversations, setConversations] = React.useState<
    ConversationSummary[]
  >([]);
  const [detail, setDetail] = React.useState<ConversationDetail | null>(null);
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [assets, setAssets] = React.useState<AssetsResponse | null>(null);
  const [composerText, setComposerText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [finalTouching, setFinalTouching] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [liveAt, setLiveAt] = React.useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = React.useState<boolean | null>(
    null,
  );
  const [recomputing, setRecomputing] = React.useState(false);
  const [selectedRule, setSelectedRule] = React.useState<{
    hit: string;
    messageId: string;
    messageText: string | null;
    ai: AiMeta | null;
  } | null>(null);

  const loadAssets = React.useCallback(async () => {
    const response = await fetch('/api/assets');
    if (!response.ok) return;
    const data = (await response.json()) as AssetsResponse;
    setAssets(data);
  }, []);

  const loadTemplates = React.useCallback(async () => {
    const response = await fetch('/api/inbox/templates');
    if (!response.ok) return;
    const data = (await response.json()) as { templates: Template[] };
    setTemplates(data.templates ?? []);
  }, []);

  const loadConversations = React.useCallback(async () => {
    if (featureEnabled === false) return;
    const params = new URLSearchParams();
    if (tab === 'needs_followup') {
      params.set('needs_followup', 'true');
    } else {
      params.set('state', tab);
    }
    if (channel !== 'all') {
      params.set('channel', channel);
    }
    if (assetId !== 'all') {
      params.set('assetId', assetId);
    }
    if (query.trim()) {
      params.set('q', query.trim());
    }
    params.set('limit', '80');
    const response = await fetch(
      `/api/inbox/conversations?${params.toString()}`,
    );
    if (!response.ok) return;
    const data = (await response.json()) as {
      conversations: ConversationSummary[];
    };
    let list = data.conversations ?? [];
    if (sort === 'oldest') {
      list = [...list].sort((a, b) =>
        (a.lastInboundAt ?? '').localeCompare(b.lastInboundAt ?? ''),
      );
    }
    setConversations(list);
  }, [assetId, channel, featureEnabled, query, sort, tab]);

  const loadConversationDetail = React.useCallback(async () => {
    if (featureEnabled === false) return;
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const response = await fetch(
      `/api/inbox/conversations/${selectedId}?all=true`,
    );
    if (!response.ok) {
      setDetail(null);
      return;
    }
    const data = (await response.json()) as ConversationDetail;
    setDetail(data);
  }, [featureEnabled, selectedId]);

  React.useEffect(() => {
    void loadAssets();
    void loadTemplates();
  }, [loadAssets, loadTemplates]);

  React.useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/feature-flags');
        if (!response.ok) return;
        const data = (await response.json()) as { followupInbox?: boolean };
        setFeatureEnabled(Boolean(data.followupInbox));
      } catch {
        setFeatureEnabled(null);
      }
    })();
  }, []);

  React.useEffect(() => {
    if (!showSpam && tab === 'SPAM') {
      setTab('needs_followup');
    }
  }, [showSpam, tab]);

  React.useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  React.useEffect(() => {
    void loadConversationDetail();
  }, [loadConversationDetail]);

  React.useEffect(() => {
    setSelectedRule(null);
  }, [selectedId]);

  React.useEffect(() => {
    if (featureEnabled === false) {
      return;
    }
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let attempts = 0;
    let cancelled = false;
    const lastRefreshRef = { current: 0 };

    const connect = () => {
      if (socket) socket.close();
      const wsUrl = buildInboxWsUrl();
      const current = new WebSocket(wsUrl);
      socket = current;
      current.addEventListener('open', () => {
        attempts = 0;
        current.send(JSON.stringify({ type: 'request_latest' }));
      });
      current.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data as string) as {
            conversationId?: string;
            updatedAt?: string;
          };
          if (!payload.conversationId) return;
          const now = Date.now();
          if (now - lastRefreshRef.current < 1500) {
            return;
          }
          lastRefreshRef.current = now;
          setLiveAt(payload.updatedAt ?? new Date().toISOString());
          void loadConversations();
          if (payload.conversationId === selectedId) {
            void loadConversationDetail();
          }
        } catch {
          // ignore
        }
      });
      current.addEventListener('close', () => {
        if (cancelled || socket !== current) return;
        const jitter = Math.floor(Math.random() * 250);
        const delay = Math.min(1000 * 2 ** attempts, 10000) + jitter;
        attempts += 1;
        retryTimer = window.setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [featureEnabled, loadConversations, loadConversationDetail, selectedId]);

  const handleSelectConversation = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('id', id);
      return next;
    });
  };

  const handleSend = async () => {
    if (!selectedId || !composerText.trim()) return;
    setSending(true);
    setStatus(null);
    try {
      const response = await fetch(
        `/api/inbox/conversations/${selectedId}/send`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: composerText.trim() }),
        },
      );
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data?.error ?? 'Send failed');
      }
      setComposerText('');
      setStatus('Message sent.');
      void loadConversationDetail();
      void loadConversations();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const handleOutcome = async (outcome: 'converted' | 'lost' | 'unknown') => {
    if (!selectedId) return;
    const response = await fetch(
      `/api/inbox/conversations/${selectedId}/off_platform_outcome`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome }),
      },
    );
    if (response.ok) {
      void loadConversationDetail();
      void loadConversations();
    }
  };

  const handleRecompute = async () => {
    if (!selectedId) return;
    const response = await fetch(
      `/api/inbox/conversations/${selectedId}/recompute`,
      { method: 'POST' },
    );
    if (response.ok) {
      void loadConversationDetail();
      void loadConversations();
    }
  };

  const handleFinalTouch = async () => {
    if (!selectedId || !detail?.conversation.finalTouchRequired) return;
    if (finalTouching) return;
    const confirmed = window.confirm(
      'Send the final courtesy message? This is only sent once.',
    );
    if (!confirmed) return;
    setFinalTouching(true);
    setStatus(null);
    try {
      const response = await fetch(
        `/api/inbox/conversations/${selectedId}/final-touch`,
        { method: 'POST' },
      );
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data?.error ?? 'Final touch failed');
      }
      setStatus('Final courtesy message sent.');
      void loadConversationDetail();
      void loadConversations();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Final touch failed');
    } finally {
      setFinalTouching(false);
    }
  };

  const handleRecomputeAll = async () => {
    if (recomputing) return;
    const confirmed = window.confirm(
      'Recompute inference for all conversations? This may take a bit.',
    );
    if (!confirmed) return;
    setRecomputing(true);
    setStatus(null);
    try {
      const response = await fetch('/api/inbox/recompute-all', {
        method: 'POST',
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data?.error ?? 'Recompute failed');
      }
      const data = (await response.json()) as { updated?: number };
      setStatus(
        `Recomputed ${data.updated ?? 0} conversation${
          data.updated === 1 ? '' : 's'
        }.`,
      );
      void loadConversations();
      void loadConversationDetail();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Recompute failed');
    } finally {
      setRecomputing(false);
    }
  };

  const latestReasons = detail?.stateEvents?.length
    ? detail.stateEvents[detail.stateEvents.length - 1]?.reasons ?? []
    : [];

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      {featureEnabled === false ? (
        <section {...stylex.props(layout.card)}>
          <h2>Inbox Disabled</h2>
          <p {...stylex.props(layout.note)}>
            The Conversation Inspector is behind the FEATURE_FOLLOWUP_INBOX
            flag.
          </p>
        </section>
      ) : null}
      <section {...stylex.props(layout.card, styles.appReview)}>
        <strong>App Review Mode</strong>
        <div>
          1) Select an asset filter (optional). 2) Open a conversation. 3) Send
          a reply from Msgstats. 4) Confirm it appears in Messenger or
          Instagram.
        </div>
      </section>

      <section {...stylex.props(layout.card)}>
        <div {...stylex.props(styles.wrapper)}>
          <div {...stylex.props(styles.topBar)}>
            <div {...stylex.props(styles.filtersGroup)}>
              {[
                ...stateTabs,
                ...(showSpam ? [{ key: 'SPAM', label: 'Spam' }] : []),
              ].map((entry) => (
                <button
                  key={entry.key}
                  {...stylex.props(layout.ghostButton)}
                  onClick={() => setTab(entry.key)}
                  style={
                    tab === entry.key
                      ? { backgroundColor: palette.mint }
                      : undefined
                  }
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div {...stylex.props(styles.filtersGroup)}>
              <select
                {...stylex.props(styles.select)}
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                <option value="all">All assets</option>
                {(assets?.pages ?? []).map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                  </option>
                ))}
                {(assets?.igAssets ?? []).map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
              <select
                {...stylex.props(styles.select)}
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
              >
                <option value="all">All channels</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
              </select>
              <select
                {...stylex.props(styles.select)}
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="oldest">Oldest unanswered</option>
                <option value="recent">Newest first</option>
              </select>
              <button
                {...stylex.props(layout.ghostButton)}
                onClick={handleRecomputeAll}
                disabled={recomputing}
              >
                {recomputing ? 'Recomputing…' : 'Recompute All'}
              </button>
              <label
                style={{ display: 'flex', gap: '6px', alignItems: 'center' }}
              >
                <input
                  type="checkbox"
                  checked={showSpam}
                  onChange={(event) => setShowSpam(event.target.checked)}
                />
                <span style={{ fontSize: '12px', color: palette.slate }}>
                  Show spam
                </span>
              </label>
              <input
                {...stylex.props(styles.input)}
                placeholder="Search name, handle, snippet"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div {...stylex.props(styles.liveIndicator)}>
              <span {...stylex.props(styles.dot)} />
              Live {liveAt ? `· updated ${formatRelative(liveAt)}` : ''}
            </div>
          </div>

          <div {...stylex.props(styles.panels)}>
            <div {...stylex.props(styles.list)}>
              {conversations.length === 0 ? (
                <div {...stylex.props(layout.note)}>
                  No conversations yet. Trigger a sync to populate.
                </div>
              ) : null}
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  {...stylex.props(
                    styles.listItem,
                    selectedId === conversation.id && styles.listItemActive,
                  )}
                  onClick={() => handleSelectConversation(conversation.id)}
                >
                  <strong>{conversation.participantName}</strong>
                  <div style={{ color: palette.slate, fontSize: '12px' }}>
                    {conversation.participantHandle ?? '—'} ·{' '}
                    {formatRelative(conversation.lastInboundAt)}
                  </div>
                  <div style={{ fontSize: '13px' }}>
                    {conversation.lastSnippet ?? 'No message yet'}
                  </div>
                  <div
                    style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}
                  >
                    <span {...stylex.props(styles.badge)}>
                      {conversation.channel.toUpperCase()}
                    </span>
                    {conversation.assetName ? (
                      <span {...stylex.props(styles.badge)}>
                        {conversation.assetName}
                      </span>
                    ) : null}
                    <span {...stylex.props(styles.badge)}>
                      {conversation.currentState}
                    </span>
                    {conversation.followupSuggestion ? (
                      <span
                        {...stylex.props(styles.badge, styles.badgeSecondary)}
                      >
                        {conversation.followupSuggestion}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div {...stylex.props(styles.mainPanel)}>
              {!detail ? (
                <div {...stylex.props(layout.note)}>
                  Select a conversation to inspect its state and message
                  history.
                </div>
              ) : (
                <>
                  <div>
                    <h3 style={{ margin: 0 }}>
                      {detail.conversation.participantName}
                    </h3>
                    <p {...stylex.props(layout.note)}>
                      {detail.conversation.participantHandle ?? '—'} ·{' '}
                      {detail.conversation.assetName ?? 'Unassigned asset'}
                    </p>
                  </div>

                  <div>
                    <div {...stylex.props(styles.sectionTitle)}>
                      State Timeline
                    </div>
                    <div {...stylex.props(styles.graph)}>
                      {detail.stateEvents.length === 0 ? (
                        <span {...stylex.props(layout.note)}>
                          No state changes yet.
                        </span>
                      ) : null}
                      {detail.stateEvents.map((event) => (
                        <div
                          key={event.id}
                          {...stylex.props(
                            styles.node,
                            event.toState ===
                              detail.conversation.currentState &&
                              styles.nodeActive,
                          )}
                          title={`${event.toState} · ${event.confidence} · ${new Date(
                            event.triggeredAt,
                          ).toLocaleString()}`}
                        >
                          {event.toState}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div {...stylex.props(styles.divider)} />

                  <div>
                    <div {...stylex.props(styles.sectionTitle)}>
                      Why This State
                    </div>
                    <div style={{ display: 'grid', gap: '8px' }}>
                      <div>
                        <strong>{detail.conversation.currentState}</strong> ·{' '}
                        {detail.conversation.currentConfidence}
                      </div>
                      <div>
                        Follow-up:{' '}
                        {detail.conversation.followupSuggestion ?? 'None'}
                      </div>
                      {detail.conversation.followupDueAt ? (
                        <div>
                          Due:{' '}
                          {new Date(
                            detail.conversation.followupDueAt,
                          ).toLocaleString()}
                        </div>
                      ) : null}
                      <div>
                        Reasons:{' '}
                        {latestReasons.length
                          ? latestReasons.map(formatReason).join(', ')
                          : '—'}
                      </div>
                      {detail.conversation.lostReasonCode ===
                      'LOST_INACTIVE_TIMEOUT' ? (
                        <div>
                          Final courtesy message:{' '}
                          {detail.conversation.finalTouchSentAt
                            ? `Sent ${new Date(
                                detail.conversation.finalTouchSentAt,
                              ).toLocaleString()}`
                            : detail.conversation.finalTouchRequired
                              ? 'Not sent yet'
                              : 'Not required'}
                        </div>
                      ) : null}
                      <div>
                        Last evaluated:{' '}
                        {detail.conversation.lastEvaluatedAt
                          ? new Date(
                              detail.conversation.lastEvaluatedAt,
                            ).toLocaleString()
                          : '—'}
                      </div>
                      {detail.conversation.lostReasonCode ===
                        'LOST_INACTIVE_TIMEOUT' &&
                      detail.conversation.finalTouchRequired ? (
                        <button
                          {...stylex.props(layout.ghostButton)}
                          onClick={handleFinalTouch}
                          disabled={finalTouching}
                        >
                          {finalTouching
                            ? 'Sending final courtesy...'
                            : 'Send final courtesy'}
                        </button>
                      ) : null}
                      <button
                        {...stylex.props(layout.ghostButton)}
                        onClick={handleRecompute}
                      >
                        Recompute
                      </button>
                    </div>
                  </div>

                  {detail.conversation.currentState === 'OFF_PLATFORM' ? (
                    <div>
                      <div {...stylex.props(styles.sectionTitle)}>
                        Off-Platform Outcome (Optional)
                      </div>
                      <div {...stylex.props(styles.actionsRow)}>
                        <button
                          {...stylex.props(layout.ghostButton)}
                          onClick={() => handleOutcome('converted')}
                        >
                          Converted
                        </button>
                        <button
                          {...stylex.props(layout.ghostButton)}
                          onClick={() => handleOutcome('lost')}
                        >
                          Lost
                        </button>
                        <button
                          {...stylex.props(layout.ghostButton)}
                          onClick={() => handleOutcome('unknown')}
                        >
                          Unknown
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <div {...stylex.props(styles.sectionTitle)}>Messages</div>
                    <div {...stylex.props(styles.timeline)}>
                      {detail.messages.map((message) => (
                        <div
                          key={message.id}
                          {...stylex.props(
                            styles.message,
                            message.direction === 'outbound'
                              ? styles.outbound
                              : styles.inbound,
                          )}
                        >
                          <div
                            style={{ fontSize: '12px', color: palette.slate }}
                          >
                            {message.senderName ?? 'Unknown'} ·{' '}
                            {new Date(message.createdAt).toLocaleString()}
                          </div>
                          <div>{message.body ?? '—'}</div>
                          {message.ruleHits.length ? (
                            <div {...stylex.props(styles.chipRow)}>
                              {message.ruleHits.map((hit) => (
                                <button
                                  key={hit}
                                  {...stylex.props(styles.chip)}
                                  onClick={() =>
                                    setSelectedRule({
                                      hit,
                                      messageId: message.id,
                                      messageText: message.body ?? null,
                                      ai: getAiMeta(message.features),
                                    })
                                  }
                                  style={{ border: 'none', cursor: 'pointer' }}
                                >
                                  {ruleLabels[hit] ?? hit}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                      {selectedRule ? (
                        <div
                          {...stylex.props(layout.card)}
                          style={{ marginTop: '12px' }}
                        >
                          <div {...stylex.props(styles.sectionTitle)}>
                            Rule Detail
                          </div>
                          <div>
                            <strong>{selectedRule.hit}</strong>
                          </div>
                          <div style={{ color: palette.slate }}>
                            {ruleDescriptions[selectedRule.hit] ??
                              'No description available.'}
                          </div>
                          {selectedRule.ai?.interpretation ? (
                            <div style={{ marginTop: '8px' }}>
                              {selectedRule.hit === 'AI_HANDOFF_INTERPRET' &&
                              selectedRule.ai.interpretation.handoff ? (
                                <>
                                  <div>
                                    Evidence:{' '}
                                    {selectedRule.ai.interpretation.handoff
                                      .evidence || '—'}
                                  </div>
                                  <div>
                                    Confidence:{' '}
                                    {
                                      selectedRule.ai.interpretation.handoff
                                        .confidence
                                    }
                                  </div>
                                  <div>
                                    Type:{' '}
                                    {selectedRule.ai.interpretation.handoff
                                      .type || '—'}
                                  </div>
                                </>
                              ) : null}
                              {selectedRule.hit === 'AI_DEFER_INTERPRET' &&
                              selectedRule.ai.interpretation.deferred ? (
                                <>
                                  <div>
                                    Evidence:{' '}
                                    {selectedRule.ai.interpretation.deferred
                                      .evidence || '—'}
                                  </div>
                                  <div>
                                    Confidence:{' '}
                                    {
                                      selectedRule.ai.interpretation.deferred
                                        .confidence
                                    }
                                  </div>
                                  <div>
                                    Bucket:{' '}
                                    {selectedRule.ai.interpretation.deferred
                                      .bucket || '—'}
                                  </div>
                                  <div>
                                    Due date:{' '}
                                    {selectedRule.ai.interpretation.deferred
                                      .due_date_iso || '—'}
                                  </div>
                                </>
                              ) : null}
                              {selectedRule.ai.model ||
                              selectedRule.ai.prompt_version ? (
                                <div style={{ marginTop: '6px' }}>
                                  Model: {selectedRule.ai.model ?? '—'} ·
                                  Prompt:{' '}
                                  {selectedRule.ai.prompt_version ?? '—'}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <div style={{ marginTop: '6px' }}>
                            Matched in message:{' '}
                            {selectedRule.messageText ?? '—'}
                          </div>
                          <button
                            {...stylex.props(layout.ghostButton)}
                            onClick={() => setSelectedRule(null)}
                            style={{ marginTop: '8px' }}
                          >
                            Close
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div {...stylex.props(styles.sectionTitle)}>Reply</div>
                    <div {...stylex.props(styles.composer)}>
                      <div {...stylex.props(styles.actionsRow)}>
                        <select
                          {...stylex.props(styles.select)}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (!value) return;
                            const selected = templates.find(
                              (template) => template.id === value,
                            );
                            if (selected) {
                              setComposerText((prev) =>
                                prev
                                  ? `${prev}\n${selected.body}`
                                  : selected.body,
                              );
                            }
                            event.currentTarget.value = '';
                          }}
                        >
                          <option value="">Insert saved response</option>
                          {templates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.title}
                            </option>
                          ))}
                        </select>
                        {status ? (
                          <span {...stylex.props(layout.note)}>{status}</span>
                        ) : null}
                      </div>
                      <textarea
                        {...stylex.props(styles.textarea)}
                        placeholder="Write a reply"
                        value={composerText}
                        onChange={(event) =>
                          setComposerText(event.target.value)
                        }
                      />
                      <div {...stylex.props(styles.actionsRow)}>
                        <button
                          {...stylex.props(layout.button)}
                          onClick={handleSend}
                          disabled={sending || !composerText.trim()}
                        >
                          {sending ? 'Sending…' : 'Send reply'}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
