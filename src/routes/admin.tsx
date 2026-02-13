import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';

type OrganizationMember = {
  userId: string;
  email: string;
  name: string;
  role: string;
  metaUserIds: string[];
  metaAccounts: Array<{ id: string; expiresAt: number | null }>;
  pages: Array<{ id: string; name: string | null }>;
  igAssets: Array<{ id: string; name: string | null }>;
  userFlags: Record<string, string>;
};

type OrganizationRecord = {
  orgId: string;
  orgName: string;
  createdAt: number;
  members: OrganizationMember[];
  orgFlags: Record<string, string>;
};

type PaginationInfo = {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

const styles = stylex.create({
  page: {
    display: 'grid',
    gap: '14px',
  },
  card: {
    border: '1px solid rgba(12, 27, 26, 0.14)',
    borderRadius: '12px',
    padding: '12px',
    backgroundColor: '#fff',
    display: 'grid',
    gap: '10px',
  },
  title: {
    margin: 0,
    fontSize: '22px',
    fontWeight: 700,
    color: '#0c1b1a',
  },
  orgHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    flexWrap: 'wrap',
  },
  orgName: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 700,
    color: '#0c1b1a',
  },
  note: {
    margin: 0,
    fontSize: '12px',
    color: '#284b63',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  th: {
    textAlign: 'left',
    borderBottom: '1px solid rgba(12, 27, 26, 0.14)',
    paddingBottom: '8px',
    color: '#284b63',
  },
  tr: {
    borderBottom: '1px solid rgba(12, 27, 26, 0.08)',
  },
  td: {
    padding: '8px 0',
    color: '#0c1b1a',
    verticalAlign: 'top',
  },
  flagEditor: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  flagList: {
    display: 'grid',
    gap: '8px',
  },
  flagRow: {
    display: 'grid',
    gap: '8px',
    gridTemplateColumns: 'minmax(140px, 220px) minmax(0, 160px)',
    alignItems: 'center',
  },
  flagKey: {
    margin: 0,
    fontSize: '12px',
    color: '#0c1b1a',
    fontWeight: 600,
  },
  select: {
    border: '1px solid rgba(12, 27, 26, 0.2)',
    borderRadius: '8px',
    padding: '6px 8px',
    backgroundColor: '#fff',
    fontSize: '12px',
    color: '#0c1b1a',
  },
  assetGrid: {
    display: 'grid',
    gap: '8px',
    gridTemplateColumns: 'minmax(0, 1fr)',
  },
  assetBlock: {
    border: '1px solid rgba(12, 27, 26, 0.12)',
    borderRadius: '10px',
    padding: '8px',
    backgroundColor: '#fbfdfd',
    display: 'grid',
    gap: '4px',
  },
  input: {
    border: '1px solid rgba(12, 27, 26, 0.2)',
    borderRadius: '8px',
    padding: '6px 8px',
    fontSize: '12px',
    minWidth: '160px',
  },
  mono: {
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: '11px',
    color: '#284b63',
    margin: 0,
  },
});

const formatList = (items: Array<{ id: string; name: string | null }>) =>
  items.map((item) => `${item.name ?? item.id} (${item.id})`).join(', ');

function formatMetaExpiry(value: number | null) {
  if (!value) {
    return 'Unknown';
  }
  const ms = value > 1_000_000_000_000 ? value : value * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return date.toLocaleString();
}

const VALID_FEATURE_FLAGS = [
  {
    key: 'FEATURE_FOLLOWUP_INBOX',
    label: 'Follow-up Inbox',
  },
  {
    key: 'FEATURE_OPS_DASHBOARD',
    label: 'Ops Dashboard',
  },
  {
    key: 'FEATURE_AUDIT_CONVERSATIONS',
    label: 'Audit Conversations',
  },
] as const;

type FlagState = 'default' | 'enabled' | 'disabled';

function parseFlagState(
  flags: Record<string, string>,
  key: (typeof VALID_FEATURE_FLAGS)[number]['key'],
): FlagState {
  const raw = flags[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return 'default';
  }
  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) {
    return 'enabled';
  }
  if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) {
    return 'disabled';
  }
  return 'default';
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }
}

export default function AdminRoute(): React.ReactElement {
  const [organizations, setOrganizations] = React.useState<
    OrganizationRecord[]
  >([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [savingKey, setSavingKey] = React.useState<string | null>(null);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [limit] = React.useState(10);
  const [offset, setOffset] = React.useState(0);
  const [pagination, setPagination] = React.useState<PaginationInfo>({
    total: 0,
    limit: 10,
    offset: 0,
    hasMore: false,
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) {
        params.set('q', search);
      }
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      const response = await fetch(
        `/api/admin/organizations?${params.toString()}`,
        {
          cache: 'no-store',
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? 'Failed to load admin data.');
      }
      const payload = (await response.json()) as {
        organizations?: OrganizationRecord[];
        pagination?: PaginationInfo;
      };
      setOrganizations(payload.organizations ?? []);
      setPagination(
        payload.pagination ?? {
          total: 0,
          limit,
          offset,
          hasMore: false,
        },
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [limit, offset, search]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const updateOrgFlag = React.useCallback(
    async (orgId: string, flagKey: string, next: FlagState) => {
      const trackingKey = `org:${orgId}:${flagKey}`;
      setSavingKey(trackingKey);
      try {
        await postJson(
          `/api/admin/feature-flags/org/${encodeURIComponent(orgId)}`,
          {
            flagKey,
            flagValue:
              next === 'default' ? null : next === 'enabled' ? 'true' : 'false',
          },
        );
        await load();
      } finally {
        setSavingKey(null);
      }
    },
    [load],
  );

  const updateUserFlag = React.useCallback(
    async (userId: string, flagKey: string, next: FlagState) => {
      const trackingKey = `user:${userId}:${flagKey}`;
      setSavingKey(trackingKey);
      try {
        await postJson(
          `/api/admin/feature-flags/user/${encodeURIComponent(userId)}`,
          {
            flagKey,
            flagValue:
              next === 'default' ? null : next === 'enabled' ? 'true' : 'false',
          },
        );
        await load();
      } finally {
        setSavingKey(null);
      }
    },
    [load],
  );

  return (
    <div {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.card)}>
        <h1 {...stylex.props(styles.title)}>Admin</h1>
        <p {...stylex.props(layout.note)}>
          View organizations, users, Meta-linked assets, and edit org/user
          feature flags.
        </p>
        <form
          {...stylex.props(styles.searchRow)}
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            setSearch(searchInput.trim());
          }}
        >
          <input
            placeholder="Search org name or id"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
            }}
            {...stylex.props(styles.input)}
          />
          <button {...stylex.props(layout.button)} type="submit">
            Search
          </button>
          <button
            {...stylex.props(layout.ghostButton)}
            type="button"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setOffset(0);
            }}
          >
            Clear
          </button>
          <p {...stylex.props(styles.note)}>
            Showing {organizations.length} of {pagination.total}
          </p>
        </form>
        <div {...stylex.props(styles.searchRow)}>
          <button
            {...stylex.props(layout.ghostButton)}
            disabled={offset <= 0 || loading}
            onClick={() => {
              setOffset((previous) => Math.max(0, previous - limit));
            }}
          >
            Previous
          </button>
          <button
            {...stylex.props(layout.ghostButton)}
            disabled={!pagination.hasMore || loading}
            onClick={() => {
              setOffset((previous) => previous + limit);
            }}
          >
            Next
          </button>
        </div>
      </section>

      {loading ? (
        <p {...stylex.props(layout.note)}>Loading admin data...</p>
      ) : null}
      {error ? <p {...stylex.props(layout.note)}>{error}</p> : null}

      {organizations.map((org) => (
        <section key={org.orgId} {...stylex.props(styles.card)}>
          {(() => {
            const metaAccountsById = new Map<
              string,
              { id: string; expiresAt: number | null }
            >();
            for (const member of org.members) {
              for (const account of member.metaAccounts) {
                const existing = metaAccountsById.get(account.id);
                if (
                  !existing ||
                  (account.expiresAt ?? 0) > (existing.expiresAt ?? 0)
                ) {
                  metaAccountsById.set(account.id, account);
                }
              }
            }
            const metaAccounts = Array.from(metaAccountsById.values());
            const pageMap = new Map<
              string,
              { id: string; name: string | null }
            >();
            const igMap = new Map<
              string,
              { id: string; name: string | null }
            >();
            for (const member of org.members) {
              for (const page of member.pages) {
                pageMap.set(page.id, page);
              }
              for (const ig of member.igAssets) {
                igMap.set(ig.id, ig);
              }
            }
            const orgPages = Array.from(pageMap.values());
            const orgIgs = Array.from(igMap.values());
            return (
              <>
                <div {...stylex.props(styles.orgHeader)}>
                  <h2 {...stylex.props(styles.orgName)}>{org.orgName}</h2>
                  <p {...stylex.props(styles.mono)}>{org.orgId}</p>
                </div>

                <div {...stylex.props(styles.flagList)}>
                  {VALID_FEATURE_FLAGS.map((flag) => {
                    const currentState = parseFlagState(org.orgFlags, flag.key);
                    const key = `org:${org.orgId}:${flag.key}`;
                    return (
                      <div key={flag.key} {...stylex.props(styles.flagRow)}>
                        <p {...stylex.props(styles.flagKey)}>{flag.label}</p>
                        <select
                          {...stylex.props(styles.select)}
                          value={currentState}
                          disabled={savingKey === key}
                          onChange={(event) => {
                            void updateOrgFlag(
                              org.orgId,
                              flag.key,
                              event.target.value as FlagState,
                            );
                          }}
                        >
                          <option value="default">default</option>
                          <option value="enabled">enabled</option>
                          <option value="disabled">disabled</option>
                        </select>
                      </div>
                    );
                  })}
                </div>

                <div {...stylex.props(styles.assetGrid)}>
                  <section {...stylex.props(styles.assetBlock)}>
                    <p {...stylex.props(styles.flagKey)}>
                      Meta accounts ({metaAccounts.length})
                    </p>
                    {metaAccounts.length ? (
                      <div>
                        {metaAccounts.map((account) => (
                          <p key={account.id} {...stylex.props(styles.note)}>
                            {account.id} • expires{' '}
                            {formatMetaExpiry(account.expiresAt)}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p {...stylex.props(styles.note)}>(none)</p>
                    )}
                  </section>
                  <section {...stylex.props(styles.assetBlock)}>
                    <p {...stylex.props(styles.flagKey)}>
                      Facebook pages ({orgPages.length})
                    </p>
                    <p {...stylex.props(styles.note)}>
                      {orgPages.length ? formatList(orgPages) : '(none)'}
                    </p>
                  </section>
                  <section {...stylex.props(styles.assetBlock)}>
                    <p {...stylex.props(styles.flagKey)}>
                      Instagram assets ({orgIgs.length})
                    </p>
                    <p {...stylex.props(styles.note)}>
                      {orgIgs.length ? formatList(orgIgs) : '(none)'}
                    </p>
                  </section>
                </div>

                <table {...stylex.props(styles.table)}>
                  <thead>
                    <tr>
                      <th {...stylex.props(styles.th)}>User</th>
                      <th {...stylex.props(styles.th)}>User flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.members.map((member) => (
                      <tr
                        key={`${org.orgId}:${member.userId}`}
                        {...stylex.props(styles.tr)}
                      >
                        <td {...stylex.props(styles.td)}>
                          <div>{member.name}</div>
                          <div {...stylex.props(styles.note)}>
                            {member.email} • {member.role}
                          </div>
                          <p {...stylex.props(styles.mono)}>{member.userId}</p>
                        </td>
                        <td {...stylex.props(styles.td)}>
                          <div {...stylex.props(styles.flagList)}>
                            {VALID_FEATURE_FLAGS.map((flag) => {
                              const currentState = parseFlagState(
                                member.userFlags,
                                flag.key,
                              );
                              const key = `user:${member.userId}:${flag.key}`;
                              return (
                                <div
                                  key={flag.key}
                                  {...stylex.props(styles.flagRow)}
                                >
                                  <p {...stylex.props(styles.flagKey)}>
                                    {flag.label}
                                  </p>
                                  <select
                                    {...stylex.props(styles.select)}
                                    value={currentState}
                                    disabled={savingKey === key}
                                    onChange={(event) => {
                                      void updateUserFlag(
                                        member.userId,
                                        flag.key,
                                        event.target.value as FlagState,
                                      );
                                    }}
                                  >
                                    <option value="default">default</option>
                                    <option value="enabled">enabled</option>
                                    <option value="disabled">disabled</option>
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            );
          })()}
        </section>
      ))}
    </div>
  );
}
