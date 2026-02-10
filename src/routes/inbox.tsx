import * as React from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';
import { AppFooter } from '../app/components/AppFooter';
import { Toast, type ToastTone } from '../components/Toast';
import { inboxStyles } from './inbox.styles';
import {
  ToolbarSelect,
  type ToolbarSelectOption,
} from '../components/ToolbarSelect';
import {
  renderTemplate,
  type TemplateRenderContext,
} from '../templates/renderTemplate';

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
  needsFollowup?: boolean;
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
};

type AssetsResponse = {
  pages: Array<{ id: string; name: string }>;
  igAssets: Array<{ id: string; name: string }>;
};

type AuthResponse = {
  authenticated: boolean;
  userId?: string;
  name?: string | null;
  email?: string | null;
};

type FeatureFlagsResponse = {
  followupInbox?: boolean;
  opsDashboard?: boolean;
  auditConversations?: boolean;
};

type ClassificationExplainResponse = {
  computed_label: string;
  reason_codes: string[];
  feature_snapshot: Record<string, unknown>;
  classifier_version?: string | null;
  computed_at: number;
};

type FilterGroupKey =
  | 'needs_followup'
  | 'active'
  | 'DEFERRED'
  | 'OFF_PLATFORM'
  | 'LOST'
  | 'CONVERTED'
  | 'SPAM';

type FilterGroupOption = {
  key: FilterGroupKey;
  title: string;
  description: string;
};

type FilterGroupCounts = Record<FilterGroupKey, number>;

const baseFilterGroups: FilterGroupOption[] = [
  {
    key: 'needs_followup',
    title: 'Needs follow-up',
    description: 'Conversations that need action now.',
  },
  {
    key: 'active',
    title: 'Active',
    description: 'Any conversation that is not Lost.',
  },
  {
    key: 'DEFERRED',
    title: 'Deferred',
    description: 'Scheduled for a specific future follow-up.',
  },
  {
    key: 'OFF_PLATFORM',
    title: 'Off-platform',
    description: 'Likely moved to phone/email or another channel.',
  },
  {
    key: 'LOST',
    title: 'Lost',
    description: 'Closed without conversion.',
  },
  {
    key: 'CONVERTED',
    title: 'Converted',
    description: 'Closed-won conversations.',
  },
  {
    key: 'SPAM',
    title: 'Spam',
    description: 'Spam, abuse, and non-actionable conversations.',
  },
];

const auditLabelOptions = [
  'NEW',
  'ENGAGED',
  'PRODUCTIVE',
  'HIGHLY_PRODUCTIVE',
  'PRICE_GIVEN',
  'DEFERRED',
  'OFF_PLATFORM',
  'CONVERTED',
  'LOST',
  'SPAM',
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
  SPAM_PHRASE_MATCH: 'Spam phrase-level signal detected.',
  SPAM_CONTEXT_CONFIRMED: 'Spam context checks passed.',
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
  PRICE_REJECTION: 'Customer rejected pricing as too high.',
  PRICE_REJECTION_STALE: 'Lost after unresolved price rejection.',
  EXPLICIT_REJECTION: 'Customer explicitly declined (e.g. no / no thanks).',
  INDEFINITE_DEFERRAL: 'Customer deferred with no concrete date.',
  INDEFINITE_DEFERRAL_STALE: 'Indefinite deferral went stale.',
  WAIT_TO_PROCEED: 'Customer indicates they must wait to proceed.',
  RESURRECTED: 'New inbound after a long inactivity gap.',
  USER_ANNOTATION: 'User annotation applied.',
  BLOCKED_BY_RECIPIENT: 'Recipient blocked further messages.',
  BOUNCED: 'Delivery failed or recipient unreachable.',
  OFF_PLATFORM_NO_CONTACT_INFO: 'Off-platform inferred without contact info.',
  OFF_PLATFORM_STALE: 'Off-platform state became stale.',
  DEFERRAL_SEASON_PARSED: 'Seasonal deferral date parsed.',
  SPAM_CONTENT: 'Non-actionable ranting or disengagement content.',
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

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const SEARCH_LABEL = 'MSGSTATS_NEEDS_REPLY';
const BUSINESS_INBOX_URL = 'https://business.facebook.com/latest/inbox';

const isReplyWindowClosed = (input: {
  needsReply: boolean;
  lastInboundAt: string | null;
}) => {
  if (!input.needsReply) return false;
  if (!input.lastInboundAt) return true;
  const lastInboundMs = Date.parse(input.lastInboundAt);
  if (Number.isNaN(lastInboundMs)) return true;
  return Date.now() - lastInboundMs > REPLY_WINDOW_MS;
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
type InspectorTab = 'conversation' | 'templates';

const INSPECTOR_STORAGE_KEY = 'msgstats:inbox:inspector-open';
const INSPECTOR_TAB_STORAGE_KEY = 'inbox.inspector.activeTab';

const getViewportMode = (): ViewportMode => {
  if (typeof window === 'undefined') return 'wide';
  if (window.innerWidth < 960) return 'small';
  if (window.innerWidth < 1280) return 'medium';
  return 'wide';
};

const getStoredInspectorTab = (): InspectorTab => {
  if (typeof window === 'undefined') return 'conversation';
  const value = window.localStorage.getItem(INSPECTOR_TAB_STORAGE_KEY);
  if (value === 'templates' || value === 'conversation') {
    return value;
  }
  return 'conversation';
};

const TEMPLATE_HELPER_VARIABLES: Array<{ label: string; snippet: string }> = [
  { label: 'Lead first name', snippet: '{{lead.first_name}}' },
  { label: 'Lead full name', snippet: '{{lead.full_name}}' },
  { label: 'Platform', snippet: '{{conversation.platform}}' },
  { label: 'Channel', snippet: '{{conversation.channel}}' },
  { label: 'Current state', snippet: '{{conversation.state}}' },
  { label: 'Asset name', snippet: '{{asset.name}}' },
];

const TEMPLATE_HELPER_CONDITIONALS: Array<{
  label: string;
  snippet: string;
  placeholder: string;
}> = [
  {
    label: 'If state is DEFERRED',
    snippet: `{{#if stateIs:DEFERRED}}\nYOUR_TEXT_HERE\n{{/if}}`,
    placeholder: 'YOUR_TEXT_HERE',
  },
  {
    label: 'If had PRICE_GIVEN',
    snippet: `{{#if hadState:PRICE_GIVEN}}\nYOUR_TEXT_HERE\n{{else}}\nYOUR_TEXT_HERE\n{{/if}}`,
    placeholder: 'YOUR_TEXT_HERE',
  },
  {
    label: 'Fallback greeting',
    snippet: `{{#if lead.first_name}}\nHi {{lead.first_name}},\n{{else}}\nHi there,\n{{/if}}`,
    placeholder: 'Hi there,',
  },
];

export default function Inbox(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const selectedId = searchParams.get('id');

  const [tab, setTab] = React.useState<FilterGroupKey>('needs_followup');
  const [channel, setChannel] = React.useState('all');
  const [assetId, setAssetId] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [conversations, setConversations] = React.useState<
    ConversationSummary[]
  >([]);
  const [filterGroupCounts, setFilterGroupCounts] =
    React.useState<FilterGroupCounts | null>(null);
  const [detail, setDetail] = React.useState<ConversationDetail | null>(null);
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [assets, setAssets] = React.useState<AssetsResponse | null>(null);
  const [composerText, setComposerText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [finalTouching, setFinalTouching] = React.useState(false);
  const [toast, setToast] = React.useState<{
    message: string;
    tone: ToastTone;
  } | null>(null);
  const [liveAt, setLiveAt] = React.useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = React.useState<boolean | null>(
    null,
  );
  const [auth, setAuth] = React.useState<AuthResponse | null>(null);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const [opsDashboardEnabled, setOpsDashboardEnabled] =
    React.useState<boolean>(false);
  const [auditFeatureEnabled, setAuditFeatureEnabled] =
    React.useState<boolean>(false);
  const [auditOpenConversationId, setAuditOpenConversationId] = React.useState<
    string | null
  >(null);
  const [auditMode, setAuditMode] = React.useState<'menu' | 'wrong'>('menu');
  const [auditCorrectLabel, setAuditCorrectLabel] = React.useState('LOST');
  const [auditNotes, setAuditNotes] = React.useState('');
  const [auditFollowupMode, setAuditFollowupMode] = React.useState<
    'correct' | 'wrong'
  >('correct');
  const [auditFollowupDueAt, setAuditFollowupDueAt] = React.useState('');
  const [auditFollowupNotes, setAuditFollowupNotes] = React.useState('');
  const [auditSubmitting, setAuditSubmitting] = React.useState(false);
  const [auditError, setAuditError] = React.useState<string | null>(null);
  const [auditWhyConversationId, setAuditWhyConversationId] = React.useState<
    string | null
  >(null);
  const [auditWhyLoading, setAuditWhyLoading] = React.useState(false);
  const [auditExplainByConversation, setAuditExplainByConversation] =
    React.useState<Record<string, ClassificationExplainResponse>>({});
  const [auditedConversationIds, setAuditedConversationIds] = React.useState<
    Record<string, true>
  >({});
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
  const [viewportMode, setViewportMode] = React.useState<ViewportMode>('wide');
  const [inspectorOpen, setInspectorOpen] = React.useState<boolean>(true);
  const [conversationDrawerOpen, setConversationDrawerOpen] =
    React.useState(false);
  const [inspectorTab, setInspectorTab] =
    React.useState<InspectorTab>('conversation');
  const [templateMode, setTemplateMode] = React.useState<'list' | 'create'>(
    'list',
  );
  const [templateTitle, setTemplateTitle] = React.useState('');
  const [templateBody, setTemplateBody] = React.useState('');
  const [templateError, setTemplateError] = React.useState<string | null>(null);
  const [templateStatus, setTemplateStatus] = React.useState<string | null>(
    null,
  );
  const [templateSaving, setTemplateSaving] = React.useState(false);
  const [previewTemplate, setPreviewTemplate] = React.useState<Template | null>(
    null,
  );
  const [previewRendered, setPreviewRendered] = React.useState('');
  const [previewMissingVars, setPreviewMissingVars] = React.useState<string[]>(
    [],
  );
  const [previewErrors, setPreviewErrors] = React.useState<string[]>([]);
  const inspectorToggleRef = React.useRef<HTMLButtonElement | null>(null);
  const inspectorDrawerRef = React.useRef<HTMLDivElement | null>(null);
  const conversationDrawerRef = React.useRef<HTMLDivElement | null>(null);
  const messageTimelineRef = React.useRef<HTMLDivElement | null>(null);
  const composerTextAreaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const templateBodyTextAreaRef = React.useRef<HTMLTextAreaElement | null>(
    null,
  );
  const templateBodySelectionRef = React.useRef<{ start: number; end: number }>(
    { start: 0, end: 0 },
  );
  const useTemplateSelectionRef = React.useRef<{
    start: number;
    end: number;
  } | null>(null);
  const useTemplateFromComposerFocusRef = React.useRef(false);
  const composerWasLastFocusedRef = React.useRef(false);
  const inspectorWasOpenRef = React.useRef(inspectorOpen);
  const showAiErrors =
    typeof window !== 'undefined' &&
    (import.meta.env.DEV || window.location.search.includes('ops=1'));
  const showToast = React.useCallback(
    (message: string, tone: ToastTone = 'info') => {
      setToast({ message, tone });
    },
    [],
  );
  const detailNeedsReply = Boolean(detail?.conversation.needsFollowup);
  const detailWindowClosed = isReplyWindowClosed({
    needsReply: detailNeedsReply,
    lastInboundAt: detail?.conversation.lastInboundAt ?? null,
  });

  const handleCopyInboxLabel = React.useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      showToast('Copy is not available in this browser.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(SEARCH_LABEL);
      showToast('Label copied.', 'success');
    } catch {
      showToast('Unable to copy label.', 'error');
    }
  }, [showToast]);

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

  const loadAuth = React.useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!response.ok) {
        setAuth({ authenticated: false });
        return;
      }
      const data = (await response.json()) as AuthResponse;
      setAuth(data ?? { authenticated: false });
    } catch {
      setAuth({ authenticated: false });
    }
  }, []);

  const loadConversations = React.useCallback(async () => {
    if (featureEnabled === false) return;
    const params = new URLSearchParams();
    if (tab === 'needs_followup') {
      params.set('needs_followup', 'true');
    } else if (tab === 'active') {
      params.set('group', 'active');
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
    setConversations(data.conversations ?? []);
  }, [assetId, channel, featureEnabled, query, tab]);

  const loadFilterGroupCounts = React.useCallback(async () => {
    if (featureEnabled === false) return;
    const params = new URLSearchParams();
    if (channel !== 'all') {
      params.set('channel', channel);
    }
    if (assetId !== 'all') {
      params.set('assetId', assetId);
    }
    if (query.trim()) {
      params.set('q', query.trim());
    }
    const response = await fetch(
      `/api/inbox/conversations/counts?${params.toString()}`,
    );
    if (!response.ok) return;
    const data = (await response.json()) as {
      counts?: Partial<FilterGroupCounts>;
    };
    setFilterGroupCounts({
      needs_followup: Number(data.counts?.needs_followup ?? 0),
      active: Number(data.counts?.active ?? 0),
      DEFERRED: Number(data.counts?.DEFERRED ?? 0),
      OFF_PLATFORM: Number(data.counts?.OFF_PLATFORM ?? 0),
      LOST: Number(data.counts?.LOST ?? 0),
      CONVERTED: Number(data.counts?.CONVERTED ?? 0),
      SPAM: Number(data.counts?.SPAM ?? 0),
    });
  }, [assetId, channel, featureEnabled, query]);

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
    void loadAuth();
  }, [loadAssets, loadAuth, loadTemplates]);

  React.useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/feature-flags');
        if (!response.ok) return;
        const data = (await response.json()) as FeatureFlagsResponse;
        setFeatureEnabled(Boolean(data.followupInbox));
        setOpsDashboardEnabled(Boolean(data.opsDashboard));
        setAuditFeatureEnabled(Boolean(data.auditConversations));
      } catch {
        setFeatureEnabled(null);
        setOpsDashboardEnabled(false);
        setAuditFeatureEnabled(false);
      }
    })();
  }, []);

  React.useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  React.useEffect(() => {
    void loadFilterGroupCounts();
  }, [loadFilterGroupCounts]);

  React.useEffect(() => {
    void loadConversationDetail();
  }, [loadConversationDetail]);

  React.useEffect(() => {
    setSelectedRule(null);
    setSelectedAi(null);
    setAuditOpenConversationId(null);
    setAuditWhyConversationId(null);
    setAuditError(null);
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
          void loadFilterGroupCounts();
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
  }, [
    featureEnabled,
    loadConversations,
    loadConversationDetail,
    loadFilterGroupCounts,
    selectedId,
  ]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    setViewportMode(getViewportMode());
    setInspectorOpen(localStorage.getItem(INSPECTOR_STORAGE_KEY) !== '0');
    setInspectorTab(getStoredInspectorTab());
    const onResize = () => setViewportMode(getViewportMode());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(INSPECTOR_STORAGE_KEY, inspectorOpen ? '1' : '0');
  }, [inspectorOpen]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(INSPECTOR_TAB_STORAGE_KEY, inspectorTab);
  }, [inspectorTab]);

  React.useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => {
      setToast(null);
    }, 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

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

  React.useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const composer = composerTextAreaRef.current;
      if (!(target instanceof HTMLElement)) return;
      if (target === composer) {
        composerWasLastFocusedRef.current = true;
        return;
      }
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        composerWasLastFocusedRef.current = false;
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

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

  const getConversationForAudit = React.useCallback(
    (conversationId: string) => {
      if (detail?.conversation.id === conversationId) {
        return detail.conversation;
      }
      return (
        conversations.find(
          (conversation) => conversation.id === conversationId,
        ) ?? null
      );
    },
    [conversations, detail],
  );

  const openAuditPopover = React.useCallback(
    (conversationId: string) => {
      const conversation = getConversationForAudit(conversationId);
      if (!conversation || !conversation.assetId) return;
      setAuditOpenConversationId(conversationId);
      setAuditMode('menu');
      setAuditCorrectLabel(conversation.currentState);
      setAuditNotes('');
      setAuditFollowupMode('correct');
      setAuditFollowupDueAt('');
      setAuditFollowupNotes('');
      setAuditSubmitting(false);
      setAuditError(null);
      setAuditWhyConversationId(null);
    },
    [getConversationForAudit],
  );

  const closeAuditPopover = React.useCallback(() => {
    setAuditOpenConversationId(null);
    setAuditWhyConversationId(null);
    setAuditMode('menu');
    setAuditFollowupMode('correct');
    setAuditFollowupDueAt('');
    setAuditFollowupNotes('');
    setAuditError(null);
    setAuditSubmitting(false);
  }, []);

  const loadAuditExplanation = React.useCallback(
    async (conversationId: string, assetId: string) => {
      if (auditExplainByConversation[conversationId]) {
        return auditExplainByConversation[conversationId];
      }
      setAuditWhyLoading(true);
      try {
        const params = new URLSearchParams({ assetId });
        const response = await fetch(
          `/api/inbox/conversations/${conversationId}/classification_explain?${params.toString()}`,
        );
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(
            data?.error ?? 'Failed to load classification reasons',
          );
        }
        const data = (await response.json()) as ClassificationExplainResponse;
        setAuditExplainByConversation((prev) => ({
          ...prev,
          [conversationId]: data,
        }));
        return data;
      } finally {
        setAuditWhyLoading(false);
      }
    },
    [auditExplainByConversation],
  );

  const handleAuditToggleWhy = React.useCallback(
    async (conversationId: string) => {
      if (auditWhyConversationId === conversationId) {
        setAuditWhyConversationId(null);
        return;
      }
      const conversation = getConversationForAudit(conversationId);
      if (!conversation?.assetId) return;
      setAuditError(null);
      try {
        await loadAuditExplanation(conversationId, conversation.assetId);
        setAuditWhyConversationId(conversationId);
      } catch (error) {
        setAuditError(
          error instanceof Error ? error.message : 'Failed to load explanation',
        );
      }
    },
    [auditWhyConversationId, getConversationForAudit, loadAuditExplanation],
  );

  const submitAudit = React.useCallback(
    async (conversationId: string, isCorrect: boolean) => {
      const conversation = getConversationForAudit(conversationId);
      if (!conversation?.assetId || auditSubmitting) return;
      setAuditSubmitting(true);
      setAuditError(null);
      try {
        const body: {
          assetId: string;
          is_correct: boolean;
          correct_label?: string;
          followup_is_correct?: boolean;
          followup_correct_due_at?: number;
          followup_notes?: string;
          notes?: string;
        } = {
          assetId: conversation.assetId,
          is_correct: isCorrect,
        };
        if (!isCorrect) {
          body.correct_label = auditCorrectLabel;
          if (auditNotes.trim()) {
            body.notes = auditNotes.trim();
          }
        } else if (auditNotes.trim()) {
          body.notes = auditNotes.trim();
        }
        if (auditFollowupMode === 'wrong') {
          const dueAtMs = auditFollowupDueAt
            ? Date.parse(auditFollowupDueAt)
            : Number.NaN;
          if (!auditFollowupNotes.trim() && Number.isNaN(dueAtMs)) {
            throw new Error(
              'Add follow-up notes or a corrected follow-up date.',
            );
          }
          body.followup_is_correct = false;
          if (!Number.isNaN(dueAtMs)) {
            body.followup_correct_due_at = dueAtMs;
          }
          if (auditFollowupNotes.trim()) {
            body.followup_notes = auditFollowupNotes.trim();
          }
        }
        const response = await fetch(
          `/api/inbox/conversations/${conversationId}/audit`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data?.error ?? 'Failed to save audit');
        }
        setAuditedConversationIds((prev) => ({
          ...prev,
          [conversationId]: true,
        }));
        showToast('Audit saved.', 'success');
        closeAuditPopover();
      } catch (error) {
        setAuditError(
          error instanceof Error ? error.message : 'Failed to save audit',
        );
      } finally {
        setAuditSubmitting(false);
      }
    },
    [
      auditCorrectLabel,
      auditFollowupDueAt,
      auditFollowupMode,
      auditFollowupNotes,
      auditNotes,
      auditSubmitting,
      closeAuditPopover,
      getConversationForAudit,
      showToast,
    ],
  );

  const handleSend = async () => {
    if (!selectedId || !composerText.trim()) return;
    if (detailWindowClosed) {
      showToast(
        'Open Meta Business Inbox to continue this conversation.',
        'info',
      );
      return;
    }
    setSending(true);
    setToast(null);
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
      showToast('Message sent.', 'success');
      void loadConversationDetail();
      void loadConversations();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Send failed',
        'error',
      );
    } finally {
      setSending(false);
    }
  };

  const handleUseTemplate = (template: Template) => {
    const selectedConversation = conversations.find(
      (conversation) => conversation.id === selectedId,
    );
    const renderContext: TemplateRenderContext = {
      lead: {
        first_name:
          (
            detail?.conversation.participantName ??
            selectedConversation?.participantName ??
            ''
          )
            .split(' ')
            .filter(Boolean)[0] ?? '',
        full_name:
          detail?.conversation.participantName ??
          selectedConversation?.participantName ??
          '',
      },
      conversation: {
        id: detail?.conversation.id ?? selectedConversation?.id ?? '',
        platform:
          detail?.conversation.channel ??
          selectedConversation?.channel ??
          'unknown',
        channel:
          detail?.conversation.channel ??
          selectedConversation?.channel ??
          'unknown',
        state:
          detail?.conversation.currentState ??
          selectedConversation?.currentState ??
          '',
        timeline:
          detail?.stateEvents.map((event) => ({
            state: event.toState,
            at: event.triggeredAt,
          })) ?? [],
      },
      asset: {
        id: detail?.conversation.assetId ?? selectedConversation?.assetId ?? '',
        name:
          detail?.conversation.assetName ??
          selectedConversation?.assetName ??
          '',
      },
      business: {
        display_name:
          detail?.conversation.assetName ??
          selectedConversation?.assetName ??
          '',
      },
      user: {
        display_name: '',
      },
    };
    const rendered = renderTemplate(template.body, renderContext);
    if (rendered.errors.length) {
      setTemplateError(rendered.errors.join(' '));
      return;
    }
    setTemplateError(null);
    if (rendered.missingVars.length) {
      setTemplateStatus(
        `Inserted with missing variables: ${rendered.missingVars.join(', ')}`,
      );
    } else {
      setTemplateStatus('Template inserted.');
    }
    const insertion = rendered.text.trim();
    if (!insertion) return;
    const fromComposerFocus = useTemplateFromComposerFocusRef.current;
    const selection = useTemplateSelectionRef.current;
    setComposerText((previous) => {
      if (fromComposerFocus && selection) {
        const start = Math.max(0, Math.min(selection.start, previous.length));
        const end = Math.max(start, Math.min(selection.end, previous.length));
        const next = `${previous.slice(0, start)}${insertion}${previous.slice(end)}`;
        const caret = start + insertion.length;
        window.requestAnimationFrame(() => {
          const node = composerTextAreaRef.current;
          if (!node) return;
          node.focus();
          composerWasLastFocusedRef.current = true;
          node.setSelectionRange(caret, caret);
        });
        return next;
      }
      const next = previous
        ? `${previous}${previous.endsWith('\n') ? '' : '\n'}${insertion}`
        : insertion;
      window.requestAnimationFrame(() => {
        const node = composerTextAreaRef.current;
        if (!node) return;
        node.focus();
        composerWasLastFocusedRef.current = true;
        const caret = next.length;
        node.setSelectionRange(caret, caret);
      });
      return next;
    });
    useTemplateFromComposerFocusRef.current = false;
    useTemplateSelectionRef.current = null;
  };

  const captureTemplateInsertionAnchor = () => {
    const node = composerTextAreaRef.current;
    const focusedInComposer = Boolean(node) && document.activeElement === node;
    const useSelectionAnchor =
      focusedInComposer || composerWasLastFocusedRef.current;
    useTemplateFromComposerFocusRef.current = useSelectionAnchor;
    if (!useSelectionAnchor) {
      useTemplateSelectionRef.current = null;
      return;
    }
    if (focusedInComposer && node) {
      useTemplateSelectionRef.current = {
        start: node.selectionStart ?? 0,
        end: node.selectionEnd ?? 0,
      };
    }
  };

  const insertTemplateSnippet = (options: {
    snippetText: string;
    placeholderText?: string;
  }) => {
    const bodyNode = templateBodyTextAreaRef.current;
    const isBodyFocused =
      Boolean(bodyNode) && document.activeElement === bodyNode;
    const bodySelection = {
      start: isBodyFocused ? bodyNode?.selectionStart ?? 0 : 0,
      end: isBodyFocused ? bodyNode?.selectionEnd ?? 0 : 0,
    };

    setTemplateBody((previous) => {
      const start = isBodyFocused
        ? Math.max(0, Math.min(bodySelection.start, previous.length))
        : previous.length;
      const end = isBodyFocused
        ? Math.max(start, Math.min(bodySelection.end, previous.length))
        : previous.length;
      const next = `${previous.slice(0, start)}${options.snippetText}${previous.slice(end)}`;
      const placeholder = options.placeholderText;
      const placeholderIdx = placeholder
        ? options.snippetText.indexOf(placeholder)
        : -1;
      const selectionStart =
        placeholderIdx >= 0
          ? start + placeholderIdx
          : start + options.snippetText.length;
      const selectionEnd =
        placeholderIdx >= 0
          ? selectionStart + (placeholder?.length ?? 0)
          : selectionStart;
      window.requestAnimationFrame(() => {
        const node = templateBodyTextAreaRef.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(selectionStart, selectionEnd);
        templateBodySelectionRef.current = {
          start: selectionStart,
          end: selectionEnd,
        };
      });
      return next;
    });
  };

  const handlePreviewTemplate = (template: Template) => {
    const selectedConversation = conversations.find(
      (conversation) => conversation.id === selectedId,
    );
    const renderContext: TemplateRenderContext = {
      lead: {
        first_name:
          (
            detail?.conversation.participantName ??
            selectedConversation?.participantName ??
            ''
          )
            .split(' ')
            .filter(Boolean)[0] ?? '',
        full_name:
          detail?.conversation.participantName ??
          selectedConversation?.participantName ??
          '',
      },
      conversation: {
        id: detail?.conversation.id ?? selectedConversation?.id ?? '',
        platform:
          detail?.conversation.channel ??
          selectedConversation?.channel ??
          'unknown',
        channel:
          detail?.conversation.channel ??
          selectedConversation?.channel ??
          'unknown',
        state:
          detail?.conversation.currentState ??
          selectedConversation?.currentState ??
          '',
        timeline:
          detail?.stateEvents.map((event) => ({
            state: event.toState,
            at: event.triggeredAt,
          })) ?? [],
      },
      asset: {
        id: detail?.conversation.assetId ?? selectedConversation?.assetId ?? '',
        name:
          detail?.conversation.assetName ??
          selectedConversation?.assetName ??
          '',
      },
      business: {
        display_name:
          detail?.conversation.assetName ??
          selectedConversation?.assetName ??
          '',
      },
      user: {
        display_name: '',
      },
    };
    const rendered = renderTemplate(template.body, renderContext);
    setPreviewTemplate(template);
    setPreviewRendered(rendered.text);
    setPreviewMissingVars(rendered.missingVars);
    setPreviewErrors(rendered.errors);
  };

  const resetTemplateCreate = () => {
    setTemplateTitle('');
    setTemplateBody('');
    setTemplateError(null);
  };

  const handleSaveTemplate = async () => {
    setTemplateError(null);
    setTemplateStatus(null);
    if (!templateTitle.trim() || !templateBody.trim()) {
      setTemplateError('Title and body are required.');
      return;
    }
    setTemplateSaving(true);
    try {
      const response = await fetch('/api/inbox/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: templateTitle.trim(),
          body: templateBody.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to save template.');
      }
      await loadTemplates();
      setTemplateStatus('Template saved.');
      setTemplateMode('list');
      resetTemplateCreate();
    } catch (error) {
      setTemplateError(
        error instanceof Error ? error.message : 'Failed to save template.',
      );
    } finally {
      setTemplateSaving(false);
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
    setToast(null);
    try {
      const response = await fetch(
        `/api/inbox/conversations/${selectedId}/final-touch`,
        { method: 'POST' },
      );
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data?.error ?? 'Final touch failed');
      }
      showToast('Final courtesy message sent.', 'success');
      void loadConversationDetail();
      void loadConversations();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Final touch failed',
        'error',
      );
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
    setToast(null);
    try {
      const response = await fetch('/api/inbox/recompute-all', {
        method: 'POST',
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data?.error ?? 'Recompute failed');
      }
      const data = (await response.json()) as {
        updated?: number;
        queued?: boolean;
      };
      if (data.queued) {
        showToast(
          'Recompute queued. Refresh in a moment for updated states.',
          'info',
        );
      } else {
        showToast(
          `Recomputed ${data.updated ?? 0} conversation${
            data.updated === 1 ? '' : 's'
          }.`,
          'success',
        );
      }
      void loadConversations();
      void loadFilterGroupCounts();
      void loadConversationDetail();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Recompute failed',
        'error',
      );
    } finally {
      setRecomputing(false);
    }
  };

  const renderAuditPopover = (conversationId: string) => {
    const conversation = getConversationForAudit(conversationId);
    if (!conversation || !conversation.assetId) return null;
    const explain = auditExplainByConversation[conversationId];
    const showWhy = auditWhyConversationId === conversationId;
    return (
      <div {...stylex.props(inboxStyles.auditPopover)}>
        <div {...stylex.props(inboxStyles.auditPopoverTitle)}>
          Audit {conversation.currentState}
        </div>
        <div {...stylex.props(inboxStyles.actionsRow)}>
          <button
            type="button"
            {...stylex.props(layout.ghostButton)}
            onClick={() => setAuditMode('menu')}
          >
            Label correct
          </button>
          <button
            type="button"
            {...stylex.props(layout.ghostButton)}
            onClick={() => setAuditMode('wrong')}
          >
            Label wrong
          </button>
          <button
            type="button"
            {...stylex.props(layout.ghostButton)}
            disabled={auditWhyLoading}
            onClick={() => void handleAuditToggleWhy(conversationId)}
          >
            {showWhy ? 'Hide why' : auditWhyLoading ? 'Loading…' : 'Why?'}
          </button>
        </div>
        {showWhy && explain ? (
          <div {...stylex.props(inboxStyles.auditReasonRow)}>
            {explain.reason_codes.length ? (
              explain.reason_codes.map((code) => (
                <span key={code} {...stylex.props(inboxStyles.auditReasonChip)}>
                  {ruleDescriptions[code] ?? code}
                </span>
              ))
            ) : (
              <span {...stylex.props(inboxStyles.auditPopoverLabel)}>
                No reason codes.
              </span>
            )}
          </div>
        ) : null}
        {auditMode === 'wrong' ? (
          <>
            <label {...stylex.props(inboxStyles.auditPopoverLabel)}>
              Correct label
            </label>
            <select
              {...stylex.props(inboxStyles.select)}
              value={auditCorrectLabel}
              onChange={(event) => setAuditCorrectLabel(event.target.value)}
            >
              {auditLabelOptions.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <label {...stylex.props(inboxStyles.auditPopoverLabel)}>
          Label notes
        </label>
        <textarea
          {...stylex.props(inboxStyles.auditTextArea)}
          placeholder="Optional notes"
          value={auditNotes}
          onChange={(event) => setAuditNotes(event.target.value)}
        />
        <label {...stylex.props(inboxStyles.auditPopoverLabel)}>
          Follow-up schedule
        </label>
        <div {...stylex.props(inboxStyles.actionsRow)}>
          <button
            type="button"
            {...stylex.props(layout.ghostButton)}
            onClick={() => setAuditFollowupMode('correct')}
          >
            Correct
          </button>
          <button
            type="button"
            {...stylex.props(layout.ghostButton)}
            onClick={() => setAuditFollowupMode('wrong')}
          >
            Wrong
          </button>
        </div>
        {auditFollowupMode === 'wrong' ? (
          <>
            <label {...stylex.props(inboxStyles.auditPopoverLabel)}>
              Correct follow-up date
            </label>
            <input
              type="datetime-local"
              {...stylex.props(inboxStyles.input)}
              value={auditFollowupDueAt}
              onChange={(event) => setAuditFollowupDueAt(event.target.value)}
            />
            <label {...stylex.props(inboxStyles.auditPopoverLabel)}>
              Follow-up notes
            </label>
            <textarea
              {...stylex.props(inboxStyles.auditTextArea)}
              placeholder="Required if no corrected date"
              value={auditFollowupNotes}
              onChange={(event) => setAuditFollowupNotes(event.target.value)}
            />
          </>
        ) : null}
        <div {...stylex.props(inboxStyles.actionsRow)}>
          <button
            type="button"
            {...stylex.props(layout.ghostButton)}
            disabled={auditSubmitting}
            onClick={() =>
              void submitAudit(conversationId, auditMode !== 'wrong')
            }
          >
            {auditSubmitting ? 'Saving…' : 'Submit'}
          </button>
          <button
            type="button"
            {...stylex.props(layout.ghostButton)}
            disabled={auditSubmitting}
            onClick={closeAuditPopover}
          >
            Cancel
          </button>
        </div>
        {auditError ? (
          <span {...stylex.props(layout.note)} style={{ color: '#7f1d1d' }}>
            {auditError}
          </span>
        ) : null}
      </div>
    );
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
          <div {...stylex.props(inboxStyles.rowItem)}>
            <button
              type="button"
              {...stylex.props(
                inboxStyles.row,
                inboxStyles.rowMainButton,
                selectedId === conversation.id && inboxStyles.rowSelected,
              )}
              onClick={() => handleSelectConversation(conversation.id)}
              aria-pressed={selectedId === conversation.id}
            >
              <span
                {...stylex.props(
                  inboxStyles.rowTitle,
                  selectedId === conversation.id &&
                    inboxStyles.rowTitleSelected,
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
          </div>
        </li>
      ))}
    </ul>
  );

  const filterGroups = React.useMemo<FilterGroupOption[]>(
    () => baseFilterGroups,
    [],
  );
  const assetOptions = React.useMemo<ToolbarSelectOption[]>(() => {
    const options: ToolbarSelectOption[] = [
      {
        value: 'all',
        title: 'All assets',
        description: 'Every connected page and Instagram asset.',
      },
    ];
    for (const page of assets?.pages ?? []) {
      options.push({
        value: page.id,
        title: page.name,
        description: 'Facebook Page',
      });
    }
    for (const asset of assets?.igAssets ?? []) {
      options.push({
        value: asset.id,
        title: asset.name,
        description: 'Instagram Asset',
      });
    }
    return options;
  }, [assets]);
  const channelOptions = React.useMemo<ToolbarSelectOption[]>(
    () => [
      {
        value: 'all',
        title: 'All channels',
        description: 'Facebook and Instagram conversations.',
      },
      {
        value: 'facebook',
        title: 'Facebook',
        description: 'Messenger conversations only.',
      },
      {
        value: 'instagram',
        title: 'Instagram',
        description: 'Instagram DM conversations only.',
      },
    ],
    [],
  );

  const conversationInspectorPanel = (
    <div
      id="inbox-inspector-conversation-panel"
      role="tabpanel"
      aria-labelledby="inbox-inspector-tab-conversation"
      hidden={inspectorTab !== 'conversation'}
      {...stylex.props(inboxStyles.panelScroll)}
    >
      {!detail ? (
        <div {...stylex.props(inboxStyles.emptyState)}>
          Select a conversation to view details.
        </div>
      ) : (
        <div {...stylex.props(inboxStyles.metaScroll)}>
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
        </div>
      )}
    </div>
  );

  const templatesInspectorPanel = (
    <div
      id="inbox-inspector-templates-panel"
      role="tabpanel"
      aria-labelledby="inbox-inspector-tab-templates"
      hidden={inspectorTab !== 'templates'}
      {...stylex.props(inboxStyles.panelScroll)}
    >
      <div {...stylex.props(inboxStyles.metaScroll)}>
        <div {...stylex.props(inboxStyles.templatesHeaderRow)}>
          <h3 style={{ margin: 0 }}>Templates</h3>
          {templateMode === 'list' ? (
            <button
              type="button"
              {...stylex.props(layout.ghostButton)}
              onClick={() => {
                setTemplateMode('create');
                setTemplateError(null);
              }}
            >
              New template
            </button>
          ) : (
            <button
              type="button"
              {...stylex.props(layout.ghostButton)}
              onClick={() => {
                setTemplateMode('list');
                resetTemplateCreate();
              }}
            >
              Back to list
            </button>
          )}
        </div>

        {templateError ? (
          <div {...stylex.props(inboxStyles.templateError)}>
            {templateError}
          </div>
        ) : null}
        {templateStatus ? (
          <div {...stylex.props(inboxStyles.templateStatus)}>
            {templateStatus}
          </div>
        ) : null}

        {templateMode === 'create' ? (
          <div {...stylex.props(inboxStyles.detailCard)}>
            <label {...stylex.props(inboxStyles.fieldLabel)}>
              Title
              <input
                {...stylex.props(inboxStyles.templateInput)}
                value={templateTitle}
                onChange={(event) => setTemplateTitle(event.target.value)}
                placeholder="Template title"
              />
            </label>
            <label {...stylex.props(inboxStyles.fieldLabel)}>
              Body
              <textarea
                ref={templateBodyTextAreaRef}
                {...stylex.props(inboxStyles.templateTextArea)}
                value={templateBody}
                onChange={(event) => setTemplateBody(event.target.value)}
                onSelect={(event) => {
                  templateBodySelectionRef.current = {
                    start: event.currentTarget.selectionStart ?? 0,
                    end: event.currentTarget.selectionEnd ?? 0,
                  };
                }}
                placeholder="Template message"
              />
            </label>
            <div {...stylex.props(inboxStyles.actionsRow)}>
              <button
                type="button"
                {...stylex.props(layout.button)}
                disabled={templateSaving}
                onClick={handleSaveTemplate}
              >
                {templateSaving ? 'Saving…' : 'Save template'}
              </button>
            </div>
            <section {...stylex.props(inboxStyles.templateHelpers)}>
              <div {...stylex.props(inboxStyles.templateHelpersTitle)}>
                Template helpers
              </div>
              <div {...stylex.props(inboxStyles.templateHelpersHint)}>
                Inserts into the template body.
              </div>
              <div {...stylex.props(inboxStyles.templateHelperGroup)}>
                <div {...stylex.props(inboxStyles.templateHelperHeading)}>
                  Variables
                </div>
                <div {...stylex.props(inboxStyles.templateHelperChips)}>
                  {TEMPLATE_HELPER_VARIABLES.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      {...stylex.props(inboxStyles.templateHelperChip)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        insertTemplateSnippet({ snippetText: item.snippet })
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div {...stylex.props(inboxStyles.templateHelperGroup)}>
                <div {...stylex.props(inboxStyles.templateHelperHeading)}>
                  Conditionals
                </div>
                <div {...stylex.props(inboxStyles.templateHelperChips)}>
                  {TEMPLATE_HELPER_CONDITIONALS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      {...stylex.props(inboxStyles.templateHelperChip)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        insertTemplateSnippet({
                          snippetText: item.snippet,
                          placeholderText: item.placeholder,
                        })
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>
        ) : (
          <>
            {!selectedId ? (
              <div {...stylex.props(inboxStyles.emptyState)}>
                Select a conversation for richer preview context.
              </div>
            ) : null}
            <div {...stylex.props(inboxStyles.templateList)}>
              {templates.length === 0 ? (
                <div {...stylex.props(inboxStyles.emptyState)}>
                  No templates yet.
                </div>
              ) : null}
              {templates.map((template) => (
                <div
                  key={template.id}
                  {...stylex.props(inboxStyles.detailCard)}
                >
                  <div {...stylex.props(inboxStyles.templateRowHeader)}>
                    <strong>{template.title}</strong>
                  </div>
                  <div {...stylex.props(inboxStyles.templatePreview)}>
                    {template.body}
                  </div>
                  <div {...stylex.props(inboxStyles.actionsRow)}>
                    <button
                      type="button"
                      {...stylex.props(layout.button)}
                      onMouseDown={captureTemplateInsertionAnchor}
                      onClick={() => handleUseTemplate(template)}
                    >
                      Use
                    </button>
                    <button
                      type="button"
                      {...stylex.props(layout.ghostButton)}
                      onClick={() => handlePreviewTemplate(template)}
                    >
                      Preview
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {previewTemplate ? (
              <div {...stylex.props(inboxStyles.previewPanel)}>
                <div {...stylex.props(inboxStyles.previewHeader)}>
                  <strong>{previewTemplate.title}</strong>
                </div>
                <pre {...stylex.props(inboxStyles.previewText)}>
                  {previewRendered || '(empty output)'}
                </pre>
                {previewMissingVars.length ? (
                  <div {...stylex.props(inboxStyles.warningBox)}>
                    Missing variables: {previewMissingVars.join(', ')}
                  </div>
                ) : null}
                {previewErrors.length ? (
                  <div {...stylex.props(inboxStyles.errorBox)}>
                    {previewErrors.join(' ')}
                  </div>
                ) : null}
                <div {...stylex.props(inboxStyles.actionsRow)}>
                  <button
                    type="button"
                    {...stylex.props(layout.button)}
                    disabled={previewErrors.length > 0}
                    onMouseDown={captureTemplateInsertionAnchor}
                    onClick={() => {
                      handleUseTemplate(previewTemplate);
                      setPreviewTemplate(null);
                    }}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    {...stylex.props(layout.ghostButton)}
                    onClick={() => setPreviewTemplate(null)}
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  const inspectorContent = (
    <div {...stylex.props(inboxStyles.inspectorContainer)}>
      <div
        {...stylex.props(inboxStyles.tabBar)}
        role="tablist"
        aria-label="Inspector tabs"
      >
        <button
          id="inbox-inspector-tab-conversation"
          type="button"
          role="tab"
          aria-selected={inspectorTab === 'conversation'}
          aria-controls="inbox-inspector-conversation-panel"
          {...stylex.props(
            inboxStyles.tab,
            inspectorTab === 'conversation' && inboxStyles.tabSelected,
          )}
          onClick={() => setInspectorTab('conversation')}
        >
          Conversation
        </button>
        <button
          id="inbox-inspector-tab-templates"
          type="button"
          role="tab"
          aria-selected={inspectorTab === 'templates'}
          aria-controls="inbox-inspector-templates-panel"
          {...stylex.props(
            inboxStyles.tab,
            inspectorTab === 'templates' && inboxStyles.tabSelected,
          )}
          onClick={() => setInspectorTab('templates')}
        >
          Templates
        </button>
      </div>
      {conversationInspectorPanel}
      {templatesInspectorPanel}
    </div>
  );

  const accountLabel = auth?.name || auth?.email || auth?.userId || 'Account';

  const handleLogout = async () => {
    setLoggingOut(true);
    setToast(null);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch {
      showToast('Could not log out. Please try again.', 'error');
    } finally {
      setLoggingOut(false);
    }
  };

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
            <span {...stylex.props(inboxStyles.accountName)}>
              {accountLabel}
            </span>
            <button
              type="button"
              {...stylex.props(layout.ghostButton)}
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? 'Logging out…' : 'Log out'}
            </button>
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
        <div {...stylex.props(inboxStyles.horizontalDivider)} />

        <div {...stylex.props(inboxStyles.toolbarRow)}>
          <ToolbarSelect
            ariaLabel="Conversation filter group"
            value={tab}
            options={filterGroups.map((option) => ({
              value: option.key,
              title: `${option.title} (${filterGroupCounts?.[option.key] ?? 0})`,
              description: option.description,
            }))}
            onChange={(value) => setTab(value as FilterGroupKey)}
            minWidth="280px"
          />
          <ToolbarSelect
            ariaLabel="Asset filter"
            value={assetId}
            options={assetOptions}
            onChange={setAssetId}
            minWidth="210px"
          />
          <ToolbarSelect
            ariaLabel="Channel filter"
            value={channel}
            options={channelOptions}
            onChange={setChannel}
            minWidth="210px"
          />
          <input
            {...stylex.props(inboxStyles.input, inboxStyles.toolbarSearch)}
            placeholder="Search name, handle, snippet"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            {...stylex.props(layout.ghostButton, inboxStyles.toolbarButton)}
            onClick={handleRecomputeAll}
            disabled={recomputing}
          >
            {recomputing ? 'Recomputing…' : 'Recompute All'}
          </button>
          <span
            {...stylex.props(
              inboxStyles.liveIndicator,
              inboxStyles.liveIndicatorAligned,
            )}
          >
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
          <div {...stylex.props(inboxStyles.section)}>
            <div {...stylex.props(inboxStyles.messageHeaderRow)}>
              <div {...stylex.props(inboxStyles.messageHeaderInfo)}>
                {!detail ? (
                  <span {...stylex.props(layout.note)}>
                    Select a conversation to inspect its state and message
                    history.
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
                    {auditFeatureEnabled &&
                    auditedConversationIds[detail.conversation.id] ? (
                      <span {...stylex.props(inboxStyles.auditedChip)}>
                        Audited
                      </span>
                    ) : null}
                  </>
                )}
              </div>
              <div {...stylex.props(inboxStyles.messageHeaderActions)}>
                {auditFeatureEnabled && detail?.conversation.assetId ? (
                  <div {...stylex.props(inboxStyles.auditAnchor)}>
                    <button
                      type="button"
                      {...stylex.props(inboxStyles.toggleButton)}
                      onClick={() => openAuditPopover(detail.conversation.id)}
                    >
                      Audit
                    </button>
                    {auditOpenConversationId === detail.conversation.id
                      ? renderAuditPopover(detail.conversation.id)
                      : null}
                  </div>
                ) : null}
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
              </div>
            </div>
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
              {detailWindowClosed ? (
                <div {...stylex.props(inboxStyles.windowClosedNotice)}>
                  <p {...stylex.props(inboxStyles.windowClosedText)}>
                    To message customers who haven&apos;t replied in the last 24
                    hours, reply from Meta Business Inbox.
                  </p>
                  <div {...stylex.props(inboxStyles.windowClosedActions)}>
                    <span {...stylex.props(inboxStyles.windowClosedLabel)}>
                      Search label: {SEARCH_LABEL}
                    </span>
                    <button
                      type="button"
                      {...stylex.props(inboxStyles.windowClosedButton)}
                      onClick={() => {
                        void handleCopyInboxLabel();
                      }}
                    >
                      Copy label
                    </button>
                    <a
                      href={BUSINESS_INBOX_URL}
                      target="_blank"
                      rel="noreferrer"
                      {...stylex.props(inboxStyles.windowClosedButton)}
                    >
                      Open Business Inbox
                    </a>
                  </div>
                </div>
              ) : detailNeedsReply ? (
                <div {...stylex.props(inboxStyles.needsReplyChip)}>
                  Needs reply
                </div>
              ) : null}
              <textarea
                ref={composerTextAreaRef}
                {...stylex.props(inboxStyles.textarea)}
                placeholder={
                  detailWindowClosed
                    ? 'Reply from Meta Business Inbox'
                    : 'Write a reply'
                }
                value={composerText}
                disabled={detailWindowClosed}
                onChange={(event) => {
                  setComposerText(event.target.value);
                  useTemplateSelectionRef.current = {
                    start: event.currentTarget.selectionStart ?? 0,
                    end: event.currentTarget.selectionEnd ?? 0,
                  };
                }}
                onFocus={() => {
                  composerWasLastFocusedRef.current = true;
                }}
                onSelect={(event) => {
                  useTemplateSelectionRef.current = {
                    start: event.currentTarget.selectionStart ?? 0,
                    end: event.currentTarget.selectionEnd ?? 0,
                  };
                }}
              />
              <div {...stylex.props(inboxStyles.actionsRow)}>
                <button
                  {...stylex.props(layout.button)}
                  onClick={handleSend}
                  disabled={
                    detailWindowClosed || sending || !composerText.trim()
                  }
                >
                  {sending ? 'Sending…' : 'Send reply'}
                </button>
              </div>
            </div>
          ) : null}
        </main>

        {viewportMode === 'wide' && inspectorOpen ? (
          <aside {...stylex.props(inboxStyles.pane, inboxStyles.inspectorPane)}>
            {inspectorContent}
          </aside>
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
        <div
          {...stylex.props(
            inboxStyles.drawerBody,
            inboxStyles.inspectorDrawerBody,
          )}
        >
          {inspectorContent}
        </div>
      </div>

      <footer {...stylex.props(inboxStyles.footer)}>
        <AppFooter />
      </footer>
      {toast ? (
        <Toast
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}
