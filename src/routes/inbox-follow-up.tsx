import * as React from 'react';
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

const pageStyles = stylex.create({
  wrapper: {
    display: 'grid',
    gap: '16px',
  },
  filterBar: {
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
  panel: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px',
  },
  list: {
    borderRadius: '16px',
    border: '1px solid rgba(12, 27, 26, 0.1)',
    backgroundColor: '#ffffff',
    padding: '12px',
    display: 'grid',
    gap: '8px',
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
  reasonBadge: {
    backgroundColor: '#fff4d6',
    color: '#7c3e00',
  },
  mainPanel: {
    borderRadius: '16px',
    border: '1px solid rgba(12, 27, 26, 0.1)',
    backgroundColor: '#ffffff',
    padding: '16px',
    display: 'grid',
    gap: '12px',
    maxHeight: '70vh',
    overflow: 'auto',
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
  composer: {
    display: 'grid',
    gap: '8px',
  },
  textArea: {
    width: '100%',
    minHeight: '90px',
    borderRadius: '12px',
    border: '1px solid rgba(12, 27, 26, 0.15)',
    padding: '10px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  appReview: {
    borderRadius: '14px',
    border: '1px dashed rgba(15, 118, 110, 0.4)',
    padding: '12px 14px',
    backgroundColor: '#f2fbf9',
    display: 'grid',
    gap: '8px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  liveBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '999px',
    backgroundColor: '#e7f7f2',
    color: palette.sea,
    fontSize: '12px',
    fontWeight: 600,
  },
});

type FollowupConversation = {
  id: string;
  platform: string;
  assetId: string | null;
  assetName: string | null;
  participantName: string;
  participantHandle?: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastMessageAt: string | null;
  lastMessageBody?: string | null;
  lastMessageDirection?: string | null;
  followupReasons: string[];
  tags: string[];
};

type MessageRow = {
  id: string;
  createdAt: string;
  body: string | null;
  direction: string | null;
  senderName: string | null;
  attachments: unknown | null;
};

type ConversationDetail = {
  conversation: FollowupConversation & {
    needsFollowup: boolean;
  };
  messages: MessageRow[];
  context: {
    attribution: {
      campaignName?: string | null;
      adsetName?: string | null;
      adName?: string | null;
      clickTs?: string | null;
      source?: string | null;
      thumbUrl?: string | null;
    } | null;
    lead: {
      status?: string | null;
      stage?: string | null;
      disposition?: string | null;
      updatedAt?: string | null;
    } | null;
  };
};

type AssetOption = {
  id: string;
  name: string;
  platform: 'facebook' | 'instagram';
};

type Template = {
  id: string;
  title: string;
  body: string;
  assetId: string | null;
};

const formatRelativeTime = (value: string | null) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = date.getTime() - Date.now();
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 1000 * 60 * 60 * 24],
    ['hour', 1000 * 60 * 60],
    ['minute', 1000 * 60],
    ['second', 1000],
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, range] of ranges) {
    if (Math.abs(diffMs) >= range || unit === 'second') {
      return formatter.format(Math.round(diffMs / range), unit);
    }
  }
  return 'Just now';
};

export default function FollowUpInbox(): React.ReactElement {
  const [assets, setAssets] = React.useState<AssetOption[]>([]);
  const [conversations, setConversations] = React.useState<
    FollowupConversation[]
  >([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ConversationDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [assetId, setAssetId] = React.useState('');
  const [channel, setChannel] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState('oldest');
  const [composer, setComposer] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] =
    React.useState<string>('');
  const [bulkSelection, setBulkSelection] = React.useState<Set<string>>(
    new Set(),
  );
  const [bulkTag, setBulkTag] = React.useState('');
  const [bulkTemplateId, setBulkTemplateId] = React.useState('');
  const [bulkRunning, setBulkRunning] = React.useState(false);
  const [bulkResults, setBulkResults] = React.useState<
    Array<{ id: string; ok: boolean; error?: string }>
  >([]);
  const [flags, setFlags] = React.useState<{ followupInbox?: boolean } | null>(
    null,
  );
  const [liveStatus, setLiveStatus] = React.useState('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = React.useState<Date | null>(null);
  const initialLoadRef = React.useRef(true);
  const refreshTimerRef = React.useRef<number | null>(null);
  const selectedIdRef = React.useRef<string | null>(null);
  const detailRequestRef = React.useRef<string | null>(null);
  const listHashRef = React.useRef<string>('');

  React.useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadAssets = React.useCallback(async () => {
    const response = await fetch('/api/assets');
    if (!response.ok) return;
    const data = (await response.json()) as {
      pages: Array<{ id: string; name: string }>;
      igAssets: Array<{ id: string; name: string }>;
    };
    const next: AssetOption[] = [];
    for (const page of data.pages ?? []) {
      next.push({ id: page.id, name: page.name, platform: 'facebook' });
    }
    for (const ig of data.igAssets ?? []) {
      next.push({ id: ig.id, name: ig.name, platform: 'instagram' });
    }
    setAssets(next);
  }, []);

  const loadFlags = React.useCallback(async () => {
    try {
      const response = await fetch('/api/feature-flags');
      if (!response.ok) return;
      const data = (await response.json()) as { followupInbox?: boolean };
      setFlags(data ?? null);
    } catch {
      setFlags(null);
    }
  }, []);

  const loadTemplates = React.useCallback(async () => {
    const response = await fetch('/api/inbox/templates');
    if (!response.ok) return;
    const data = (await response.json()) as { templates: Template[] };
    setTemplates(data.templates ?? []);
  }, []);

  const loadFollowup = React.useCallback(async () => {
    if (initialLoadRef.current) {
      setLoading(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams();
      if (assetId) params.set('assetId', assetId);
      if (channel) params.set('channel', channel);
      if (search) params.set('search', search);
      if (sort) params.set('sort', sort);
      const response = await fetch(
        `/api/inbox/follow-up${params.toString() ? `?${params.toString()}` : ''}`,
      );
      if (!response.ok) {
        throw new Error('Failed to load follow-up inbox.');
      }
      const data = (await response.json()) as {
        conversations: FollowupConversation[];
      };
      const nextConversations = data.conversations ?? [];
      const nextHash = nextConversations
        .map(
          (item) =>
            `${item.id}:${item.lastMessageAt ?? ''}:${item.lastInboundAt ?? ''}:${item.followupReasons.join(',')}`,
        )
        .join('|');
      if (nextHash !== listHashRef.current) {
        listHashRef.current = nextHash;
        setConversations(nextConversations);
        setLastUpdatedAt(new Date());
      }
      if (!selectedIdRef.current) {
        const first = nextConversations[0];
        if (first) {
          setSelectedId(first.id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox.');
    } finally {
      if (initialLoadRef.current) {
        setLoading(false);
        initialLoadRef.current = false;
      }
    }
  }, [assetId, channel, search, sort]);

  const loadConversation = React.useCallback(async (id: string) => {
    detailRequestRef.current = id;
    const response = await fetch(`/api/inbox/conversations/${id}`);
    if (!response.ok) {
      setDetail(null);
      return;
    }
    const data = (await response.json()) as ConversationDetail;
    if (detailRequestRef.current === id) {
      setDetail(data);
    }
  }, []);

  React.useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  React.useEffect(() => {
    if (!flags?.followupInbox) return;
    void loadAssets();
    void loadTemplates();
    void loadFollowup();
  }, [flags?.followupInbox, loadAssets, loadTemplates, loadFollowup]);

  React.useEffect(() => {
    if (!flags?.followupInbox) return;
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadConversation(selectedId);
  }, [selectedId, loadConversation, flags?.followupInbox]);

  React.useEffect(() => {
    if (!flags?.followupInbox) return;
    let socket: WebSocket | null = null;
    let active = true;
    const connect = () => {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${wsProtocol}://${window.location.host}/inbox/subscribe`;
      socket = new WebSocket(wsUrl);
      setLiveStatus('connecting');
      socket.addEventListener('open', () => {
        if (!active) return;
        setLiveStatus('live');
        socket?.send(JSON.stringify({ type: 'request_latest' }));
      });
      socket.addEventListener('message', (event) => {
        if (!active) return;
        let payload: { conversationId?: string } | null = null;
        try {
          payload = JSON.parse(event.data as string) as {
            conversationId?: string;
          };
        } catch {
          payload = null;
        }
        if (!payload?.conversationId) {
          return;
        }
        if (refreshTimerRef.current) {
          window.clearTimeout(refreshTimerRef.current);
        }
        refreshTimerRef.current = window.setTimeout(() => {
          void loadFollowup();
          const currentId = selectedIdRef.current;
          if (currentId && payload?.conversationId === currentId) {
            void loadConversation(currentId);
          }
        }, 250);
      });
      socket.addEventListener('close', () => {
        if (!active) return;
        setLiveStatus('reconnecting');
        setTimeout(connect, 1500);
      });
      socket.addEventListener('error', () => {
        if (!active) return;
        setLiveStatus('reconnecting');
        socket?.close();
      });
    };
    connect();
    return () => {
      active = false;
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      socket?.close();
    };
  }, [loadFollowup, loadConversation, flags?.followupInbox]);

  const handleSend = async () => {
    if (!selectedId || !composer.trim()) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/inbox/conversations/${selectedId}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: composer.trim() }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? 'Failed to send message.');
      }
      setComposer('');
      await loadFollowup();
      await loadConversation(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleAddTag = async (tag: string) => {
    if (!selectedId || !tag.trim()) return;
    await fetch(`/api/inbox/conversations/${selectedId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [tag] }),
    });
    await loadFollowup();
    await loadConversation(selectedId);
  };

  const handleRemoveTag = async (tag: string) => {
    if (!selectedId) return;
    await fetch(
      `/api/inbox/conversations/${selectedId}/tags/${encodeURIComponent(tag)}`,
      { method: 'DELETE' },
    );
    await loadFollowup();
    await loadConversation(selectedId);
  };

  const handleBulkAction = async (
    action: 'tag' | 'close' | 'send_template',
  ) => {
    if (!bulkSelection.size) return;
    if (!window.confirm('Apply bulk action to selected conversations?')) {
      return;
    }
    setBulkRunning(true);
    setBulkResults([]);
    const body: {
      conversationIds: string[];
      action: 'tag' | 'close' | 'send_template';
      tags?: string[];
      templateId?: string;
    } = {
      conversationIds: Array.from(bulkSelection),
      action,
    };
    if (action === 'tag' && bulkTag.trim()) {
      body.tags = [bulkTag.trim()];
    }
    if (action === 'send_template' && bulkTemplateId) {
      body.templateId = bulkTemplateId;
    }
    const response = await fetch('/api/inbox/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setError('Bulk action failed.');
      setBulkRunning(false);
      return;
    }
    const payload = (await response.json()) as {
      results?: Array<{ id: string; ok: boolean; error?: string }>;
    };
    setBulkResults(payload.results ?? []);
    setBulkSelection(new Set());
    setBulkTag('');
    setBulkTemplateId('');
    await loadFollowup();
    if (selectedId) await loadConversation(selectedId);
    setBulkRunning(false);
  };

  if (flags && !flags.followupInbox) {
    return (
      <section {...stylex.props(layout.card)}>
        <h2>Follow-Up Inbox</h2>
        <p {...stylex.props(layout.note)}>
          This feature is currently disabled.
        </p>
      </section>
    );
  }

  return (
    <div {...stylex.props(pageStyles.wrapper)}>
      <section {...stylex.props(pageStyles.appReview)}>
        <strong>App Review Mode</strong>
        <div>
          1) Pick an asset (optional). 2) Open a conversation. 3) Send a reply.
          4) Verify it appears in Messenger or Instagram.
        </div>
        <div>
          Asset selection is visible in the filter bar below, and all follow-up
          conversations across assets are shown by default.
        </div>
      </section>

      <section {...stylex.props(pageStyles.filterBar)}>
        <label>
          Asset
          <select
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
            style={{ marginLeft: '6px' }}
          >
            <option value="">All assets</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Channel
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            style={{ marginLeft: '6px' }}
          >
            <option value="">All</option>
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
          </select>
        </label>
        <label>
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or snippet"
            style={{ marginLeft: '6px' }}
          />
        </label>
        <label>
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            style={{ marginLeft: '6px' }}
          >
            <option value="oldest">Oldest unanswered</option>
            <option value="newest">Newest unanswered</option>
          </select>
        </label>
        <button
          {...stylex.props(layout.ghostButton)}
          onClick={() => loadFollowup()}
        >
          Refresh
        </button>
        <span {...stylex.props(pageStyles.liveBadge)}>
          {liveStatus === 'live' ? 'Live' : 'Reconnecting'}
          {lastUpdatedAt ? ` · ${lastUpdatedAt.toLocaleTimeString()}` : ''}
        </span>
      </section>

      {error ? <p style={{ color: palette.coral }}>{error}</p> : null}
      {loading ? <p {...stylex.props(layout.note)}>Loading inbox…</p> : null}

      <section {...stylex.props(pageStyles.panel)}>
        <div {...stylex.props(pageStyles.list)}>
          <div {...stylex.props(layout.note)}>
            {conversations.length} conversations need follow-up
          </div>
          <div style={{ display: 'grid', gap: '8px' }}>
            {conversations.map((conversation) => {
              const active = conversation.id === selectedId;
              const selected = bulkSelection.has(conversation.id);
              return (
                <div
                  key={conversation.id}
                  {...stylex.props(
                    pageStyles.listItem,
                    active && pageStyles.listItemActive,
                  )}
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => {
                        event.stopPropagation();
                        const next = new Set(bulkSelection);
                        if (event.target.checked) {
                          next.add(conversation.id);
                        } else {
                          next.delete(conversation.id);
                        }
                        setBulkSelection(next);
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <strong>{conversation.participantName}</strong>
                  </div>
                  <div style={{ color: palette.slate, fontSize: '13px' }}>
                    {conversation.lastMessageBody ?? 'No message preview'}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                    }}
                  >
                    <span {...stylex.props(pageStyles.badge)}>
                      {conversation.platform === 'instagram'
                        ? 'Instagram'
                        : 'Facebook'}
                    </span>
                    {conversation.assetName ? (
                      <span {...stylex.props(pageStyles.badge)}>
                        {conversation.assetName}
                      </span>
                    ) : null}
                    {conversation.followupReasons.map((reason) => (
                      <span
                        key={reason}
                        {...stylex.props(
                          pageStyles.badge,
                          pageStyles.reasonBadge,
                        )}
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                  <div style={{ color: palette.slate, fontSize: '12px' }}>
                    Last inbound{' '}
                    {formatRelativeTime(conversation.lastInboundAt)}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ borderTop: '1px solid #f2f4f8', paddingTop: '12px' }}>
            <strong>Bulk actions</strong>
            <div style={{ display: 'grid', gap: '8px', marginTop: '8px' }}>
              {bulkRunning ? (
                <div style={{ color: palette.slate }}>Running…</div>
              ) : null}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  placeholder="Tag"
                  value={bulkTag}
                  onChange={(event) => setBulkTag(event.target.value)}
                />
                <button
                  {...stylex.props(layout.ghostButton)}
                  onClick={() => handleBulkAction('tag')}
                >
                  Apply tag
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <select
                  value={bulkTemplateId}
                  onChange={(event) => setBulkTemplateId(event.target.value)}
                >
                  <option value="">Template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.title}
                    </option>
                  ))}
                </select>
                <button
                  {...stylex.props(layout.ghostButton)}
                  onClick={() => handleBulkAction('send_template')}
                >
                  Send template
                </button>
              </div>
              <button
                {...stylex.props(layout.ghostButton)}
                onClick={() => handleBulkAction('close')}
              >
                Mark closed
              </button>
              {bulkResults.length ? (
                <div style={{ fontSize: '12px', color: palette.slate }}>
                  {bulkResults.map((result) => (
                    <div key={result.id}>
                      {result.id}:{' '}
                      {result.ok ? 'OK' : `Failed (${result.error})`}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div {...stylex.props(pageStyles.mainPanel)}>
          {detail ? (
            <>
              <div>
                <h2 style={{ marginBottom: '4px' }}>
                  {detail.conversation.participantName}
                </h2>
                <div style={{ color: palette.slate }}>
                  {detail.conversation.assetName ?? 'All assets'} ·{' '}
                  {detail.conversation.platform === 'instagram'
                    ? 'Instagram'
                    : 'Facebook'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(detail.conversation.tags ?? []).map((tag) => (
                  <button
                    key={tag}
                    {...stylex.props(layout.ghostButton)}
                    onClick={() => handleRemoveTag(tag)}
                  >
                    {tag} ×
                  </button>
                ))}
                <button
                  {...stylex.props(layout.ghostButton)}
                  onClick={() => {
                    const tag = window.prompt('Add tag');
                    if (tag) void handleAddTag(tag);
                  }}
                >
                  + Add tag
                </button>
              </div>

              <div {...stylex.props(pageStyles.timeline)}>
                {detail.messages.map((message) => (
                  <div
                    key={message.id}
                    {...stylex.props(
                      pageStyles.message,
                      message.direction === 'outbound'
                        ? pageStyles.outbound
                        : pageStyles.inbound,
                    )}
                  >
                    <div style={{ fontSize: '12px', color: palette.slate }}>
                      {message.senderName ?? 'Unknown'} ·{' '}
                      {new Date(message.createdAt).toLocaleString()}
                    </div>
                    <div>{message.body ?? 'Attachment'}</div>
                    {message.attachments ? (
                      <div style={{ fontSize: '12px', color: palette.slate }}>
                        Attachment metadata available
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <section>
                <h3>Context</h3>
                <div style={{ display: 'grid', gap: '6px' }}>
                  {detail.context.attribution ? (
                    <div>
                      <div>
                        Campaign:{' '}
                        {detail.context.attribution.campaignName ?? 'Unknown'}
                      </div>
                      <div>
                        Ad set:{' '}
                        {detail.context.attribution.adsetName ?? 'Unknown'}
                      </div>
                      <div>
                        Ad: {detail.context.attribution.adName ?? 'Unknown'}
                      </div>
                      <div>
                        Click:{' '}
                        {detail.context.attribution.clickTs
                          ? new Date(
                              detail.context.attribution.clickTs,
                            ).toLocaleString()
                          : 'Not available yet'}
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: palette.slate }}>
                      Ads context not available yet.
                    </div>
                  )}
                  {detail.context.lead ? (
                    <div>
                      <div>
                        Lead status: {detail.context.lead.status ?? '—'}
                      </div>
                      <div>Stage: {detail.context.lead.stage ?? '—'}</div>
                      <div>
                        Disposition: {detail.context.lead.disposition ?? '—'}
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: palette.slate }}>
                      Lead Center status not available yet.
                    </div>
                  )}
                </div>
              </section>

              <section {...stylex.props(pageStyles.composer)}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <select
                    value={selectedTemplateId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelectedTemplateId(value);
                      const template = templates.find(
                        (item) => item.id === value,
                      );
                      if (template) {
                        setComposer((prev) =>
                          prev ? `${prev}\n${template.body}` : template.body,
                        );
                      }
                    }}
                  >
                    <option value="">Insert saved response</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.title}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  {...stylex.props(pageStyles.textArea)}
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                />
                <button
                  {...stylex.props(layout.button)}
                  onClick={handleSend}
                  disabled={sending}
                >
                  {sending ? 'Sending…' : 'Send reply'}
                </button>
              </section>
            </>
          ) : (
            <div style={{ color: palette.slate }}>
              Select a conversation to view messages.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
