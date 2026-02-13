import * as React from 'react';
import { Navigate } from 'react-router';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';

type Member = {
  userId: string;
  role: 'owner' | 'member' | 'coach';
  email: string;
  name: string;
  createdAt: number;
};

type Invite = {
  id: string;
  email: string;
  role: 'owner' | 'member' | 'coach';
  expiresAt: number;
  createdAt: number;
  acceptedAt: number | null;
};

type OrgSettingsPayload = {
  org: {
    orgId: string;
    orgName: string;
    createdAt: number;
  };
  members: Member[];
  invites: Invite[];
  meta: {
    accounts: Array<{
      metaUserId: string;
      userId: string;
      email: string;
      name: string;
      expiresAt: number | null;
    }>;
    pages: Array<{ id: string; name: string | null }>;
    igAssets: Array<{ id: string; name: string | null; pageId: string }>;
  };
  permissions: {
    canManage: boolean;
  };
};

type AvailablePage = {
  id: string;
  name: string;
  source?: string;
};

const styles = stylex.create({
  page: {
    display: 'grid',
    gap: '14px',
  },
  card: {
    border: '1px solid rgba(12, 27, 26, 0.14)',
    borderRadius: '12px',
    backgroundColor: '#fff',
    padding: '12px',
    display: 'grid',
    gap: '10px',
  },
  title: {
    margin: 0,
    fontSize: '22px',
    fontWeight: 700,
    color: '#0c1b1a',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  input: {
    border: '1px solid rgba(12, 27, 26, 0.2)',
    borderRadius: '8px',
    padding: '6px 8px',
    fontSize: '12px',
    minWidth: '220px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 700,
    color: '#0c1b1a',
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
    verticalAlign: 'top',
    color: '#0c1b1a',
  },
  mono: {
    margin: 0,
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontSize: '11px',
    color: '#284b63',
  },
});

async function parseResponseError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error ?? `Request failed: ${response.status}`;
}

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

export default function OrgSettingsRoute(): React.ReactElement {
  const [data, setData] = React.useState<OrgSettingsPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [orgName, setOrgName] = React.useState('');
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState<
    'owner' | 'member' | 'coach'
  >('member');
  const [availablePages, setAvailablePages] = React.useState<AvailablePage[]>(
    [],
  );
  const [assetsLoading, setAssetsLoading] = React.useState(false);
  const [assetsError, setAssetsError] = React.useState<string | null>(null);
  const [connectingPageId, setConnectingPageId] = React.useState<string | null>(
    null,
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/org/settings', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(await parseResponseError(response));
      }
      const payload = (await response.json()) as OrgSettingsPayload;
      setData(payload);
      setOrgName(payload.org.orgName);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const updateOrgName = React.useCallback(async () => {
    if (!data) return;
    const response = await fetch('/api/org/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: orgName }),
    });
    if (!response.ok) {
      throw new Error(await parseResponseError(response));
    }
    await load();
  }, [data, load, orgName]);

  const sendInvite = React.useCallback(async () => {
    if (!data) return;
    const response = await fetch(
      `/api/orgs/${encodeURIComponent(data.org.orgId)}/invites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      },
    );
    if (!response.ok) {
      throw new Error(await parseResponseError(response));
    }
    setInviteEmail('');
    await load();
  }, [data, inviteEmail, inviteRole, load]);

  const updateMemberRole = React.useCallback(
    async (userId: string, role: 'owner' | 'member' | 'coach') => {
      const response = await fetch(
        `/api/org/members/${encodeURIComponent(userId)}/role`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role }),
        },
      );
      if (!response.ok) {
        throw new Error(await parseResponseError(response));
      }
      await load();
    },
    [load],
  );

  const removeMember = React.useCallback(
    async (userId: string) => {
      const response = await fetch(
        `/api/org/members/${encodeURIComponent(userId)}`,
        {
          method: 'DELETE',
        },
      );
      if (!response.ok) {
        throw new Error(await parseResponseError(response));
      }
      await load();
    },
    [load],
  );

  const revokeInvite = React.useCallback(
    async (inviteId: string) => {
      const response = await fetch(
        `/api/org/invites/${encodeURIComponent(inviteId)}`,
        {
          method: 'DELETE',
        },
      );
      if (!response.ok) {
        throw new Error(await parseResponseError(response));
      }
      await load();
    },
    [load],
  );

  const reconnectMeta = React.useCallback(async () => {
    const response = await fetch(
      '/api/meta/token/repair?return_to=/org-settings',
      {
        method: 'POST',
      },
    );
    if (!response.ok) {
      throw new Error(await parseResponseError(response));
    }
    const payload = (await response.json()) as { reconnect_url?: string };
    window.location.href = payload.reconnect_url ?? '/api/auth/login';
  }, []);

  const syncConnectedPages = React.useCallback(async () => {
    const response = await fetch('/api/meta/pages/subscribe-connected', {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(await parseResponseError(response));
    }
    await load();
  }, [load]);

  const loadAvailablePages = React.useCallback(async () => {
    setAssetsLoading(true);
    setAssetsError(null);
    try {
      const [classicResponse, businessesResponse] = await Promise.all([
        fetch('/api/meta/accounts', { cache: 'no-store' }),
        fetch('/api/meta/businesses', { cache: 'no-store' }),
      ]);
      if (!classicResponse.ok) {
        throw new Error(await parseResponseError(classicResponse));
      }
      const classicPages = (await classicResponse.json()) as Array<{
        id: string;
        name: string;
      }>;
      let businessPages: AvailablePage[] = [];
      if (businessesResponse.ok) {
        const businesses = (await businessesResponse.json()) as Array<{
          id: string;
          name: string;
        }>;
        const pageLists = await Promise.all(
          businesses.map(async (business) => {
            const pagesResponse = await fetch(
              `/api/meta/businesses/${encodeURIComponent(business.id)}/pages`,
              { cache: 'no-store' },
            );
            if (!pagesResponse.ok) {
              return [];
            }
            const pages = (await pagesResponse.json()) as Array<{
              id: string;
              name: string;
              source?: 'owned_pages' | 'client_pages';
            }>;
            return pages.map((page) => ({
              id: page.id,
              name: page.name,
              source: page.source ?? 'business',
            }));
          }),
        );
        businessPages = pageLists.flat();
      }
      const businessPageIds = new Set(businessPages.map((page) => page.id));
      const filteredClassic = classicPages
        .filter((page) => !businessPageIds.has(page.id))
        .map((page) => ({ ...page, source: 'classic' }));
      setAvailablePages([...businessPages, ...filteredClassic]);
    } catch (nextError) {
      setAssetsError(
        nextError instanceof Error
          ? nextError.message
          : 'Could not load available Meta pages.',
      );
      setAvailablePages([]);
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!data) {
      return;
    }
    if (data.meta.accounts.length === 0) {
      return;
    }
    if (availablePages.length > 0 || assetsLoading) {
      return;
    }
    void loadAvailablePages();
  }, [assetsLoading, availablePages.length, data, loadAvailablePages]);

  const connectPage = React.useCallback(
    async (page: AvailablePage) => {
      setConnectingPageId(page.id);
      setError(null);
      try {
        const connectResponse = await fetch(
          `/api/meta/pages/${encodeURIComponent(page.id)}/token`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: page.name }),
          },
        );
        if (!connectResponse.ok) {
          throw new Error(await parseResponseError(connectResponse));
        }
        const igResponse = await fetch(
          `/api/meta/pages/${encodeURIComponent(page.id)}/ig-assets`,
        );
        if (!igResponse.ok) {
          throw new Error(await parseResponseError(igResponse));
        }
        await load();
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : 'Could not connect Meta page.',
        );
      } finally {
        setConnectingPageId(null);
      }
    },
    [load],
  );

  if (loading) {
    return (
      <section {...stylex.props(styles.card)}>
        <h1 {...stylex.props(styles.title)}>Org</h1>
        <p {...stylex.props(layout.note)}>Loading...</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section {...stylex.props(styles.card)}>
        <h1 {...stylex.props(styles.title)}>Org</h1>
        <p {...stylex.props(layout.note)}>
          {error ?? 'Unable to load org settings.'}
        </p>
      </section>
    );
  }

  if (!data.permissions.canManage) {
    return <Navigate to="/" replace />;
  }

  return (
    <div {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.card)}>
        <h1 {...stylex.props(styles.title)}>Org</h1>
        {error ? <p {...stylex.props(layout.note)}>{error}</p> : null}
        <div {...stylex.props(styles.row)}>
          <input
            value={orgName}
            onChange={(event) => {
              setOrgName(event.target.value);
            }}
            {...stylex.props(styles.input)}
          />
          <button
            {...stylex.props(layout.button)}
            onClick={() => {
              void updateOrgName();
            }}
          >
            Save name
          </button>
        </div>
        <p {...stylex.props(styles.mono)}>{data.org.orgId}</p>
      </section>

      <section {...stylex.props(styles.card)}>
        <h2 {...stylex.props(layout.title)}>Invites</h2>
        <div {...stylex.props(styles.row)}>
          <input
            type="email"
            value={inviteEmail}
            placeholder="Email"
            onChange={(event) => {
              setInviteEmail(event.target.value);
            }}
            {...stylex.props(styles.input)}
          />
          <select
            value={inviteRole}
            onChange={(event) => {
              setInviteRole(event.target.value as 'owner' | 'member' | 'coach');
            }}
            {...stylex.props(styles.input)}
          >
            <option value="member">member</option>
            <option value="coach">coach</option>
            <option value="owner">owner</option>
          </select>
          <button
            {...stylex.props(layout.button)}
            onClick={() => {
              void sendInvite();
            }}
          >
            Send invite
          </button>
        </div>
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.th)}>Email</th>
              <th {...stylex.props(styles.th)}>Role</th>
              <th {...stylex.props(styles.th)}>Status</th>
              <th {...stylex.props(styles.th)} />
            </tr>
          </thead>
          <tbody>
            {data.invites.map((invite) => (
              <tr key={invite.id} {...stylex.props(styles.tr)}>
                <td {...stylex.props(styles.td)}>{invite.email}</td>
                <td {...stylex.props(styles.td)}>{invite.role}</td>
                <td {...stylex.props(styles.td)}>
                  {invite.acceptedAt ? 'accepted' : 'pending'}
                </td>
                <td {...stylex.props(styles.td)}>
                  {!invite.acceptedAt ? (
                    <button
                      {...stylex.props(layout.ghostButton)}
                      onClick={() => {
                        void revokeInvite(invite.id);
                      }}
                    >
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section {...stylex.props(styles.card)}>
        <h2 {...stylex.props(layout.title)}>Org Access</h2>
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.th)}>User</th>
              <th {...stylex.props(styles.th)}>Role</th>
              <th {...stylex.props(styles.th)} />
            </tr>
          </thead>
          <tbody>
            {data.members.map((member) => (
              <tr key={member.userId} {...stylex.props(styles.tr)}>
                <td {...stylex.props(styles.td)}>
                  <div>{member.name}</div>
                  <div {...stylex.props(layout.note)}>{member.email}</div>
                </td>
                <td {...stylex.props(styles.td)}>
                  <select
                    value={member.role}
                    onChange={(event) => {
                      void updateMemberRole(
                        member.userId,
                        event.target.value as 'owner' | 'member' | 'coach',
                      );
                    }}
                    {...stylex.props(styles.input)}
                  >
                    <option value="owner">owner</option>
                    <option value="member">member</option>
                    <option value="coach">coach</option>
                  </select>
                </td>
                <td {...stylex.props(styles.td)}>
                  <button
                    {...stylex.props(layout.ghostButton)}
                    onClick={() => {
                      void removeMember(member.userId);
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section {...stylex.props(styles.card)}>
        <h2 {...stylex.props(layout.title)}>Meta</h2>
        <div {...stylex.props(styles.row)}>
          <a href="/api/auth/login?return_to=/org-settings">
            <button {...stylex.props(layout.button)}>Connect Meta</button>
          </a>
          <button
            {...stylex.props(layout.ghostButton)}
            onClick={() => {
              void reconnectMeta();
            }}
          >
            Refresh Meta token
          </button>
          <button
            {...stylex.props(layout.ghostButton)}
            onClick={() => {
              void syncConnectedPages();
            }}
          >
            Sync connected pages
          </button>
        </div>
        <p {...stylex.props(layout.note)}>
          Accounts: {data.meta.accounts.length} • Pages:{' '}
          {data.meta.pages.length} • IG assets: {data.meta.igAssets.length}
        </p>
        <h3 {...stylex.props(styles.sectionTitle)}>Connected Meta accounts</h3>
        {data.meta.accounts.length === 0 ? (
          <p {...stylex.props(layout.note)}>No connected Meta accounts.</p>
        ) : (
          <table {...stylex.props(styles.table)}>
            <thead>
              <tr>
                <th {...stylex.props(styles.th)}>Meta user ID</th>
                <th {...stylex.props(styles.th)}>Mapped user</th>
                <th {...stylex.props(styles.th)}>Token expires</th>
              </tr>
            </thead>
            <tbody>
              {data.meta.accounts.map((account) => (
                <tr key={account.metaUserId} {...stylex.props(styles.tr)}>
                  <td {...stylex.props(styles.td)}>
                    <p {...stylex.props(styles.mono)}>{account.metaUserId}</p>
                  </td>
                  <td {...stylex.props(styles.td)}>
                    <div>{account.name}</div>
                    <div {...stylex.props(layout.note)}>{account.email}</div>
                  </td>
                  <td {...stylex.props(styles.td)}>
                    {formatMetaExpiry(account.expiresAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3 {...stylex.props(styles.sectionTitle)}>Connected pages</h3>
        {data.meta.pages.length === 0 ? (
          <p {...stylex.props(layout.note)}>No connected pages yet.</p>
        ) : (
          <table {...stylex.props(styles.table)}>
            <thead>
              <tr>
                <th {...stylex.props(styles.th)}>Page</th>
              </tr>
            </thead>
            <tbody>
              {data.meta.pages.map((page) => (
                <tr key={page.id} {...stylex.props(styles.tr)}>
                  <td {...stylex.props(styles.td)}>
                    <div>{page.name ?? 'Page'}</div>
                    <p {...stylex.props(styles.mono)}>{page.id}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3 {...stylex.props(styles.sectionTitle)}>
          Connected Instagram profiles
        </h3>
        {data.meta.igAssets.length === 0 ? (
          <p {...stylex.props(layout.note)}>
            No connected Instagram profiles yet.
          </p>
        ) : (
          <table {...stylex.props(styles.table)}>
            <thead>
              <tr>
                <th {...stylex.props(styles.th)}>Instagram profile</th>
                <th {...stylex.props(styles.th)}>Page ID</th>
              </tr>
            </thead>
            <tbody>
              {data.meta.igAssets.map((asset) => (
                <tr key={asset.id} {...stylex.props(styles.tr)}>
                  <td {...stylex.props(styles.td)}>
                    <div>{asset.name ?? 'Instagram'}</div>
                    <p {...stylex.props(styles.mono)}>{asset.id}</p>
                  </td>
                  <td {...stylex.props(styles.td)}>
                    <p {...stylex.props(styles.mono)}>{asset.pageId}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3 {...stylex.props(styles.sectionTitle)}>Available Meta assets</h3>
        <div {...stylex.props(styles.row)}>
          <button
            {...stylex.props(layout.ghostButton)}
            onClick={() => {
              void loadAvailablePages();
            }}
            disabled={assetsLoading}
          >
            {assetsLoading ? 'Loading...' : 'Load available assets'}
          </button>
          {assetsError ? (
            <p {...stylex.props(layout.note)}>{assetsError}</p>
          ) : null}
        </div>
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.th)}>Page</th>
              <th {...stylex.props(styles.th)}>Source</th>
              <th {...stylex.props(styles.th)}>Status</th>
              <th {...stylex.props(styles.th)} />
            </tr>
          </thead>
          <tbody>
            {availablePages
              .filter(
                (page) => !data.meta.pages.some((item) => item.id === page.id),
              )
              .map((page) => {
                const connected = data.meta.pages.some(
                  (item) => item.id === page.id,
                );
                return (
                  <tr key={page.id} {...stylex.props(styles.tr)}>
                    <td {...stylex.props(styles.td)}>
                      <div>{page.name}</div>
                      <p {...stylex.props(styles.mono)}>{page.id}</p>
                    </td>
                    <td {...stylex.props(styles.td)}>
                      {page.source ?? 'business'}
                    </td>
                    <td {...stylex.props(styles.td)}>
                      {connected ? 'connected' : 'not connected'}
                    </td>
                    <td {...stylex.props(styles.td)}>
                      <button
                        {...stylex.props(layout.ghostButton)}
                        disabled={connectingPageId === page.id}
                        onClick={() => {
                          void connectPage(page);
                        }}
                      >
                        {connectingPageId === page.id
                          ? 'Connecting...'
                          : connected
                            ? 'Reconnect'
                            : 'Connect'}
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
