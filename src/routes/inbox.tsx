import * as React from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';
import { inboxStyles } from './inbox.styles';

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
  aiSummary?: {
    has_ai_processed: boolean;
    has_ai_handoff_true: boolean;
    has_ai_deferred_true: boolean;
  };
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
  input_truncated?: boolean;
  input_chars?: number;
  attempted?: boolean;
  attempt_outcome?: string;
  ran_at?: string;
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

type ViewportMode = 'small' | 'medium' | 'wide';

const INSPECTOR_STORAGE_KEY = 'msgstats:inbox:inspector-open';

const getViewportMode = (): ViewportMode => {
  if (typeof window === 'undefined') return 'wide';
  if (window.innerWidth < 960) return 'small';
  if (window.innerWidth < 1280) return 'medium';
  return 'wide';
};

export default function Inbox(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
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
  const [opsDashboardEnabled, setOpsDashboardEnabled] =
    React.useState<boolean>(false);
  const [recomputing, setRecomputing] = React.useState(false);
  const [selectedRule, setSelectedRule] = React.useState<{
    hit: string;
    messageId: string;
    messageText: string | null;
    ai: AiMeta | null;
  } | null>(null);
  const [selectedAi, setSelectedAi] = React.useState<{
    kind: 'handoff' | 'deferred' | 'error';
    messageId: string;
    messageText: string | null;
    ai: AiMeta;
  } | null>(null);
  const [viewportMode, setViewportMode] = React.useState<ViewportMode>(() =>
    getViewportMode(),
  );
  const [inspectorOpen, setInspectorOpen] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(INSPECTOR_STORAGE_KEY) !== '0';
  });
  const [conversationDrawerOpen, setConversationDrawerOpen] =
    React.useState(false);
  const inspectorToggleRef = React.useRef<HTMLButtonElement | null>(null);
  const inspectorDrawerRef = React.useRef<HTMLDivElement | null>(null);
  const conversationDrawerRef = React.useRef<HTMLDivElement | null>(null);
  const messageTimelineRef = React.useRef<HTMLDivElement | null>(null);
  const inspectorWasOpenRef = React.useRef(inspectorOpen);
  const showAiErrors =
    typeof window !== 'undefined' &&
    (import.meta.env.DEV || window.location.search.includes('ops=1'));

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
        const data = (await response.json()) as {
          followupInbox?: boolean;
          opsDashboard?: boolean;
        };
        setFeatureEnabled(Boolean(data.followupInbox));
        setOpsDashboardEnabled(Boolean(data.opsDashboard));
      } catch {
        setFeatureEnabled(null);
        setOpsDashboardEnabled(false);
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
    setSelectedAi(null);
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

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportMode(getViewportMode());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(INSPECTOR_STORAGE_KEY, inspectorOpen ? '1' : '0');
  }, [inspectorOpen]);

  React.useEffect(() => {
    if (viewportMode === 'wide') {
      setConversationDrawerOpen(false);
    }
  }, [viewportMode]);

  React.useEffect(() => {
    const wasOpen = inspectorWasOpenRef.current;
    inspectorWasOpenRef.current = inspectorOpen;
    if (viewportMode === 'wide') return;
    if (inspectorOpen) {
      window.setTimeout(() => inspectorDrawerRef.current?.focus(), 0);
      return;
    }
    if (wasOpen) {
      inspectorToggleRef.current?.focus();
    }
  }, [inspectorOpen, viewportMode]);

  React.useEffect(() => {
    if (viewportMode === 'wide' || !conversationDrawerOpen) return;
    window.setTimeout(() => conversationDrawerRef.current?.focus(), 0);
  }, [conversationDrawerOpen, viewportMode]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'i' && !event.metaKey && !event.ctrlKey) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName ?? '';
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          target?.isContentEditable
        ) {
          return;
        }
        event.preventDefault();
        setInspectorOpen((prev) => !prev);
        return;
      }
      if (event.key === 'Escape') {
        if (conversationDrawerOpen) {
          setConversationDrawerOpen(false);
          return;
        }
        if (inspectorOpen && viewportMode !== 'wide') {
          setInspectorOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [conversationDrawerOpen, inspectorOpen, viewportMode]);

  React.useEffect(() => {
    if (!selectedId) return;
    if (!detail || detail.conversation.id !== selectedId) return;
    window.requestAnimationFrame(() => {
      const node = messageTimelineRef.current;
      if (!node) return;
      node.scrollTop = node.scrollHeight;
    });
  }, [detail, selectedId]);

  const handleSelectConversation = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('id', id);
      return next;
    });
    if (viewportMode === 'small') {
      setConversationDrawerOpen(false);
    }
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
  const conversationList = (
    <ul {...stylex.props(inboxStyles.list)}>
      {conversations.length === 0 ? (
        <li {...stylex.props(inboxStyles.listEmpty)}>
          No conversations yet. Trigger a sync to populate.
        </li>
      ) : null}
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <button
            type="button"
            {...stylex.props(
              inboxStyles.row,
              selectedId === conversation.id && inboxStyles.rowSelected,
            )}
            onClick={() => handleSelectConversation(conversation.id)}
            aria-pressed={selectedId === conversation.id}
          >
            <span
              {...stylex.props(
                inboxStyles.rowTitle,
                selectedId === conversation.id && inboxStyles.rowTitleSelected,
              )}
            >
              {conversation.participantName}
            </span>
            <span {...stylex.props(inboxStyles.rowMeta)}>
              {(conversation.participantHandle ?? '—') + ' · '}
              {formatRelative(conversation.lastInboundAt)} ·{' '}
              {conversation.channel.toUpperCase()}
            </span>
            <span {...stylex.props(inboxStyles.rowSnippet)}>
              {conversation.lastSnippet ?? 'No message yet'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  const inspectorContent = (
    <div {...stylex.props(inboxStyles.metaScroll)}>
      {!detail ? (
        <span {...stylex.props(layout.note)}>
          Select a conversation to inspect metadata.
        </span>
      ) : (
        <>
          <div {...stylex.props(inboxStyles.detailCard)}>
            <h3 style={{ margin: 0 }}>Conversation State</h3>
            <div>
              <strong>{detail.conversation.currentState}</strong> ·{' '}
              {detail.conversation.currentConfidence}
            </div>
            <div>
              Follow-up: {detail.conversation.followupSuggestion ?? 'None'}
            </div>
            {detail.conversation.followupDueAt ? (
              <div>
                Due:{' '}
                {new Date(detail.conversation.followupDueAt).toLocaleString()}
              </div>
            ) : null}
            <div>
              Reasons:{' '}
              {latestReasons.length
                ? latestReasons.map(formatReason).join(', ')
                : '—'}
            </div>
            <div>
              Last evaluated:{' '}
              {detail.conversation.lastEvaluatedAt
                ? new Date(detail.conversation.lastEvaluatedAt).toLocaleString()
                : '—'}
            </div>
            <div {...stylex.props(inboxStyles.actionsRow)}>
              {detail.conversation.lostReasonCode === 'LOST_INACTIVE_TIMEOUT' &&
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

          <div {...stylex.props(inboxStyles.detailCard)}>
            <h4 style={{ margin: 0 }}>State Timeline</h4>
            {detail.stateEvents.length === 0 ? (
              <span {...stylex.props(layout.note)}>No state changes yet.</span>
            ) : (
              <div {...stylex.props(inboxStyles.chipRow)}>
                {detail.stateEvents.map((event) => (
                  <span
                    key={event.id}
                    title={`${event.toState} · ${event.confidence} · ${new Date(
                      event.triggeredAt,
                    ).toLocaleString()}`}
                    style={{
                      padding: '2px 8px',
                      borderRadius: '999px',
                      border: '1px solid rgba(12, 27, 26, 0.12)',
                      fontSize: '11px',
                      backgroundColor:
                        event.toState === detail.conversation.currentState
                          ? palette.mint
                          : '#ffffff',
                    }}
                  >
                    {event.toState}
                  </span>
                ))}
              </div>
            )}
          </div>

          {detail.conversation.currentState === 'OFF_PLATFORM' ? (
            <div {...stylex.props(inboxStyles.detailCard)}>
              <h4 style={{ margin: 0 }}>Off-Platform Outcome</h4>
              <div {...stylex.props(inboxStyles.actionsRow)}>
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

          {selectedRule ? (
            <div {...stylex.props(inboxStyles.detailCard)}>
              <h4 style={{ margin: 0 }}>Rule Detail</h4>
              <div>
                <strong>{selectedRule.hit}</strong>
              </div>
              <div style={{ color: palette.slate }}>
                {ruleDescriptions[selectedRule.hit] ??
                  'No description available.'}
              </div>
              {selectedRule.ai?.interpretation ? (
                <div>
                  {selectedRule.hit === 'AI_HANDOFF_INTERPRET' &&
                  selectedRule.ai.interpretation.handoff ? (
                    <div>
                      Evidence:{' '}
                      {selectedRule.ai.interpretation.handoff.evidence || '—'} ·
                      Confidence:{' '}
                      {selectedRule.ai.interpretation.handoff.confidence}
                    </div>
                  ) : null}
                  {selectedRule.hit === 'AI_DEFER_INTERPRET' &&
                  selectedRule.ai.interpretation.deferred ? (
                    <div>
                      Evidence:{' '}
                      {selectedRule.ai.interpretation.deferred.evidence || '—'}{' '}
                      · Confidence:{' '}
                      {selectedRule.ai.interpretation.deferred.confidence}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div>Matched message: {selectedRule.messageText ?? '—'}</div>
              <button
                {...stylex.props(layout.ghostButton)}
                onClick={() => setSelectedRule(null)}
              >
                Close
              </button>
            </div>
          ) : null}

          {selectedAi ? (
            <div {...stylex.props(inboxStyles.detailCard)}>
              <h4 style={{ margin: 0 }}>AI Detail</h4>
              <div>
                <strong>
                  {selectedAi.kind === 'handoff'
                    ? 'Handoff (AI)'
                    : selectedAi.kind === 'deferred'
                      ? 'Deferred (AI)'
                      : 'AI Error'}
                </strong>
              </div>
              {selectedAi.kind === 'error' ? (
                <div style={{ color: palette.slate }}>
                  {(selectedAi.ai.errors ?? []).join(', ') || '—'}
                </div>
              ) : null}
              <div>
                Model: {selectedAi.ai.model ?? '—'} · Prompt:{' '}
                {selectedAi.ai.prompt_version ?? '—'}
              </div>
              <div>Matched message: {selectedAi.messageText ?? '—'}</div>
              <button
                {...stylex.props(layout.ghostButton)}
                onClick={() => setSelectedAi(null)}
              >
                Close
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  if (featureEnabled === false) {
    return (
      <section {...stylex.props(layout.card)}>
        <h2>Inbox Disabled</h2>
        <p {...stylex.props(layout.note)}>
          The Conversation Inspector is behind the FEATURE_FOLLOWUP_INBOX flag.
        </p>
      </section>
    );
  }

  const inspectorOverlayOpen = viewportMode !== 'wide' && inspectorOpen;
  const scrimOpen =
    inspectorOverlayOpen ||
    (viewportMode === 'small' && conversationDrawerOpen);
  const panesInlineStyle: React.CSSProperties =
    viewportMode === 'wide'
      ? {
          gridTemplateColumns: inspectorOpen
            ? 'minmax(280px, 360px) minmax(0, 1fr) minmax(300px, 420px)'
            : 'minmax(280px, 360px) minmax(0, 1fr)',
        }
      : viewportMode === 'medium'
        ? {
            gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
          }
        : {
            gridTemplateColumns: 'minmax(0, 1fr)',
          };
  const isWideCollapsedInspector = viewportMode === 'wide' && !inspectorOpen;

  return (
    <div {...stylex.props(inboxStyles.root)}>
      <header {...stylex.props(inboxStyles.header)}>
        <div {...stylex.props(inboxStyles.headerTopRow)}>
          <nav {...stylex.props(inboxStyles.pageTabs)} aria-label="Primary">
            <Link
              to="/"
              {...stylex.props(
                inboxStyles.pageTab,
                location.pathname === '/' && inboxStyles.pageTabActive,
              )}
            >
              Dashboard
            </Link>
            <Link
              to="/inbox"
              {...stylex.props(
                inboxStyles.pageTab,
                location.pathname === '/inbox' && inboxStyles.pageTabActive,
              )}
            >
              Inbox
            </Link>
            <Link
              to="/inbox/templates"
              {...stylex.props(
                inboxStyles.pageTab,
                location.pathname === '/inbox/templates' &&
                  inboxStyles.pageTabActive,
              )}
            >
              Templates
            </Link>
            <Link
              to="/reports"
              {...stylex.props(
                inboxStyles.pageTab,
                location.pathname.startsWith('/reports') &&
                  inboxStyles.pageTabActive,
              )}
            >
              Reports
            </Link>
            {opsDashboardEnabled ? (
              <Link
                to="/ops-dashboard"
                {...stylex.props(
                  inboxStyles.pageTab,
                  location.pathname === '/ops-dashboard' &&
                    inboxStyles.pageTabActive,
                )}
              >
                Ops
              </Link>
            ) : null}
          </nav>
          <div {...stylex.props(inboxStyles.controlsGroup)}>
            {viewportMode !== 'wide' ? (
              <button
                type="button"
                ref={inspectorToggleRef}
                {...stylex.props(
                  inboxStyles.toggleButton,
                  inspectorOpen && inboxStyles.toggleButtonActive,
                )}
                onClick={() => setInspectorOpen((prev) => !prev)}
                aria-expanded={inspectorOpen}
                aria-controls="inbox-inspector-drawer"
              >
                Inspector
              </button>
            ) : null}
            <button
              type="button"
              {...stylex.props(
                inboxStyles.toggleButton,
                inboxStyles.conversationToggle,
              )}
              onClick={() => setConversationDrawerOpen(true)}
              aria-expanded={conversationDrawerOpen}
              aria-controls="inbox-conversations-drawer"
            >
              Conversations
            </button>
          </div>
        </div>

        <div {...stylex.props(inboxStyles.toolbarRow)}>
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
          <select
            {...stylex.props(inboxStyles.select)}
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
            {...stylex.props(inboxStyles.select)}
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          >
            <option value="all">All channels</option>
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
          </select>
          <select
            {...stylex.props(inboxStyles.select)}
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="oldest">Oldest unanswered</option>
            <option value="recent">Newest first</option>
          </select>
          <label
            style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}
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
            {...stylex.props(inboxStyles.input)}
            placeholder="Search name, handle, snippet"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            {...stylex.props(layout.ghostButton)}
            onClick={handleRecomputeAll}
            disabled={recomputing}
          >
            {recomputing ? 'Recomputing…' : 'Recompute All'}
          </button>
          <span {...stylex.props(inboxStyles.liveIndicator)}>
            Live {liveAt ? `· updated ${formatRelative(liveAt)}` : ''}
          </span>
        </div>
      </header>

      <div {...stylex.props(inboxStyles.panes)} style={panesInlineStyle}>
        {viewportMode !== 'small' ? (
          <aside
            {...stylex.props(inboxStyles.pane, inboxStyles.paneDividerRight)}
          >
            {conversationList}
          </aside>
        ) : null}

        <main
          {...stylex.props(
            inboxStyles.pane,
            viewportMode === 'wide' &&
              inspectorOpen &&
              inboxStyles.paneDividerRight,
            inboxStyles.messagesPane,
          )}
        >
          {isWideCollapsedInspector ? (
            <button
              type="button"
              ref={inspectorToggleRef}
              {...stylex.props(
                inboxStyles.toggleButton,
                inboxStyles.floatingInspector,
              )}
              onClick={() => setInspectorOpen(true)}
              aria-expanded={inspectorOpen}
              aria-controls="inbox-inspector-drawer"
            >
              Inspector
            </button>
          ) : null}

          <div {...stylex.props(inboxStyles.section)}>
            {!detail ? (
              <span {...stylex.props(layout.note)}>
                Select a conversation to inspect its state and message history.
              </span>
            ) : (
              <>
                <h3 style={{ margin: 0 }}>
                  {detail.conversation.participantName}
                </h3>
                <p {...stylex.props(layout.note)}>
                  {detail.conversation.participantHandle ?? '—'} ·{' '}
                  {detail.conversation.assetName ?? 'Unassigned asset'}
                </p>
              </>
            )}
          </div>

          <div
            ref={messageTimelineRef}
            {...stylex.props(inboxStyles.messageTimeline)}
          >
            {detail?.messages.map((message) => {
              const ai = getAiMeta(message.features);
              const aiHandoff = Boolean(
                ai?.interpretation?.handoff?.is_handoff,
              );
              const aiDeferred = Boolean(
                ai?.interpretation?.deferred?.is_deferred,
              );
              const aiErrors = Boolean(showAiErrors && ai?.errors?.length);
              const hasChips =
                aiHandoff || aiDeferred || aiErrors || message.ruleHits.length;
              return (
                <div
                  key={message.id}
                  {...stylex.props(
                    inboxStyles.message,
                    message.direction === 'outbound'
                      ? inboxStyles.outbound
                      : inboxStyles.inbound,
                  )}
                >
                  <div {...stylex.props(inboxStyles.messageMeta)}>
                    {message.senderName ?? 'Unknown'} ·{' '}
                    {new Date(message.createdAt).toLocaleString()}
                  </div>
                  <div>{message.body ?? '—'}</div>
                  {hasChips ? (
                    <div {...stylex.props(inboxStyles.chipRow)}>
                      {aiHandoff ? (
                        <button
                          type="button"
                          {...stylex.props(inboxStyles.chipButton)}
                          onClick={() =>
                            ai &&
                            setSelectedAi({
                              kind: 'handoff',
                              messageId: message.id,
                              messageText: message.body ?? null,
                              ai,
                            })
                          }
                        >
                          Handoff (AI)
                        </button>
                      ) : null}
                      {aiDeferred ? (
                        <button
                          type="button"
                          {...stylex.props(inboxStyles.chipButton)}
                          onClick={() =>
                            ai &&
                            setSelectedAi({
                              kind: 'deferred',
                              messageId: message.id,
                              messageText: message.body ?? null,
                              ai,
                            })
                          }
                        >
                          Deferred (AI)
                        </button>
                      ) : null}
                      {aiErrors ? (
                        <button
                          type="button"
                          {...stylex.props(inboxStyles.chipButton)}
                          onClick={() =>
                            ai &&
                            setSelectedAi({
                              kind: 'error',
                              messageId: message.id,
                              messageText: message.body ?? null,
                              ai,
                            })
                          }
                        >
                          AI error
                        </button>
                      ) : null}
                      {message.ruleHits.map((hit) => (
                        <button
                          key={hit}
                          type="button"
                          {...stylex.props(inboxStyles.chipButton)}
                          onClick={() =>
                            setSelectedRule({
                              hit,
                              messageId: message.id,
                              messageText: message.body ?? null,
                              ai: getAiMeta(message.features),
                            })
                          }
                        >
                          {ruleLabels[hit] ?? hit}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {detail ? (
            <div {...stylex.props(inboxStyles.composer)}>
              <div {...stylex.props(inboxStyles.actionsRow)}>
                <select
                  {...stylex.props(inboxStyles.select)}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) return;
                    const selected = templates.find(
                      (template) => template.id === value,
                    );
                    if (selected) {
                      setComposerText((prev) =>
                        prev ? `${prev}\n${selected.body}` : selected.body,
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
                {...stylex.props(inboxStyles.textarea)}
                placeholder="Write a reply"
                value={composerText}
                onChange={(event) => setComposerText(event.target.value)}
              />
              <div {...stylex.props(inboxStyles.actionsRow)}>
                <button
                  {...stylex.props(layout.button)}
                  onClick={handleSend}
                  disabled={sending || !composerText.trim()}
                >
                  {sending ? 'Sending…' : 'Send reply'}
                </button>
              </div>
            </div>
          ) : null}
        </main>

        {viewportMode === 'wide' && inspectorOpen ? (
          <aside {...stylex.props(inboxStyles.pane)}>{inspectorContent}</aside>
        ) : null}
      </div>

      <div
        {...stylex.props(inboxStyles.scrim, scrimOpen && inboxStyles.scrimOpen)}
        onClick={() => {
          setConversationDrawerOpen(false);
          setInspectorOpen(false);
        }}
        aria-hidden={!scrimOpen}
      />

      <div
        id="inbox-conversations-drawer"
        ref={conversationDrawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Conversations"
        tabIndex={-1}
        {...stylex.props(
          inboxStyles.drawer,
          inboxStyles.drawerLeft,
          viewportMode === 'small' &&
            conversationDrawerOpen &&
            inboxStyles.drawerOpen,
        )}
      >
        <div {...stylex.props(inboxStyles.drawerHeader)}>
          <strong>Conversations</strong>
          <button
            type="button"
            {...stylex.props(inboxStyles.toggleButton)}
            onClick={() => setConversationDrawerOpen(false)}
          >
            Close
          </button>
        </div>
        <div {...stylex.props(inboxStyles.drawerBody)}>{conversationList}</div>
      </div>

      <div
        id="inbox-inspector-drawer"
        ref={inspectorDrawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Inspector"
        tabIndex={-1}
        {...stylex.props(
          inboxStyles.drawer,
          inspectorOverlayOpen && inboxStyles.drawerOpen,
        )}
      >
        <div {...stylex.props(inboxStyles.drawerHeader)}>
          <strong>Inspector</strong>
          <button
            type="button"
            {...stylex.props(inboxStyles.toggleButton)}
            onClick={() => setInspectorOpen(false)}
          >
            Close
          </button>
        </div>
        <div {...stylex.props(inboxStyles.drawerBody)}>{inspectorContent}</div>
      </div>

      <footer {...stylex.props(inboxStyles.footer)}>
        <span>msgstats inbox</span>
        <span {...stylex.props(inboxStyles.footerSpacer)}>
          Space reserved for floating controls.
        </span>
      </footer>
    </div>
  );
}
