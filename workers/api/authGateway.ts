import type { Env } from './worker';
import {
  debugToken,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchUserProfile,
} from './meta';

type JwtClaims = {
  iss: string;
  aud: string;
  sub: string;
  org_id: string;
  role: 'owner' | 'member' | 'coach';
  email: string;
  name: string;
  meta_user_id?: string;
  iat: number;
  exp: number;
  jti: string;
};

type AuthContext = {
  claims: JwtClaims;
  token: string;
};

type Auth0TokenResponse = {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type Auth0IdToken = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nonce?: string;
  sub?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
};

type Jwk = {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  x5c?: string[];
};

type JwksResponse = {
  keys?: Jwk[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let jwksCache: { fetchedAt: number; keys: Jwk[] } | null = null;

function getMetaApiVersion(env: Env) {
  return env.META_API_VERSION ?? 'v19.0';
}

function requireNonEmpty(value: string | undefined | null, key: string) {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(`missing_env_${key}`);
  }
  return normalized;
}

function getJwtSecret(env: Env) {
  return requireNonEmpty(
    env.MSGSTATS_JWT_SECRET || env.SESSION_SECRET,
    'MSGSTATS_JWT_SECRET',
  );
}

function getSessionPepper(env: Env) {
  return requireNonEmpty(
    env.AUTH_SESSION_PEPPER || env.SESSION_SECRET,
    'AUTH_SESSION_PEPPER',
  );
}

function getInvitePepper(env: Env) {
  return requireNonEmpty(
    env.AUTH_INVITE_PEPPER || env.SESSION_SECRET,
    'AUTH_INVITE_PEPPER',
  );
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function randomBase64Url(bytes = 32) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return base64UrlEncode(arr);
}

function base64UrlEncode(input: ArrayBuffer | Uint8Array) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let str = '';
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (normalized.length % 4)) % 4;
  const decoded = atob(normalized + '='.repeat(pad));
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return base64UrlEncode(digest);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Base64Url(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(value),
  );
  return base64UrlEncode(signature);
}

function parseJwtParts(token: string) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  return { header, payload, signature };
}

function decodeJsonBase64Url<T>(value: string): T | null {
  try {
    return JSON.parse(decoder.decode(base64UrlDecode(value))) as T;
  } catch {
    return null;
  }
}

async function signMsgstatsJwt(claims: JwtClaims, secret: string) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const encodedClaims = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const payload = `${encodedHeader}.${encodedClaims}`;
  const signature = await hmacSha256Base64Url(payload, secret);
  return `${payload}.${signature}`;
}

async function verifyMsgstatsJwt(
  token: string,
  env: Env,
): Promise<JwtClaims | null> {
  const parts = parseJwtParts(token);
  if (!parts) return null;
  const signature = await hmacSha256Base64Url(
    `${parts.header}.${parts.payload}`,
    getJwtSecret(env),
  );
  if (signature !== parts.signature) return null;
  const claims = decodeJsonBase64Url<JwtClaims>(parts.payload);
  if (!claims) return null;
  const now = nowSeconds();
  if (claims.exp <= now) return null;
  if (claims.iss !== env.MSGSTATS_JWT_ISSUER) return null;
  if (claims.aud !== env.MSGSTATS_JWT_AUDIENCE) return null;
  if (!claims.sub || !claims.org_id || !claims.role) return null;
  return claims;
}

function extractBearer(headers: Headers) {
  const header = headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return header.slice(7).trim();
}

function sanitizeReturnTo(value: string | null) {
  if (!value) return '/';
  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }
  return '/';
}

function appOrigin(env: Env, req: Request) {
  return env.APP_ORIGIN ?? new URL(req.url).origin;
}

function getStateSigningSecret(env: Env) {
  return requireNonEmpty(
    env.SESSION_SECRET || env.MSGSTATS_JWT_SECRET,
    'SESSION_SECRET',
  );
}

function deriveDisplayName(input: Auth0IdToken) {
  if (input.name?.trim()) return input.name.trim();
  const combined =
    `${input.given_name ?? ''} ${input.family_name ?? ''}`.trim();
  if (combined) return combined;
  const email = input.email ?? '';
  const [local] = email.split('@');
  return local || 'msgstats user';
}

function readJson<T>(req: Request): Promise<T | null> {
  return req
    .json<T>()
    .then((value) => value)
    .catch(() => null);
}

async function importAuth0Jwk(jwk: Jwk) {
  return await crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify'],
  );
}

async function loadJwks(env: Env): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < 5 * 60 * 1000) {
    return jwksCache.keys;
  }
  const res = await fetch(env.AUTH0_JWKS_URL);
  if (!res.ok) {
    throw new Error(`jwks_fetch_failed_${res.status}`);
  }
  const body = (await res.json()) as JwksResponse;
  const keys = body.keys ?? [];
  jwksCache = { fetchedAt: now, keys };
  return keys;
}

async function verifyAuth0IdToken(
  idToken: string,
  env: Env,
  expectedNonce: string,
): Promise<Auth0IdToken> {
  const parts = parseJwtParts(idToken);
  if (!parts) {
    throw new Error('invalid_id_token_format');
  }
  const header = decodeJsonBase64Url<{ kid?: string; alg?: string }>(
    parts.header,
  );
  if (!header?.kid || header.alg !== 'RS256') {
    throw new Error('invalid_id_token_header');
  }
  const keys = await loadJwks(env);
  const jwk = keys.find((item) => item.kid === header.kid);
  if (!jwk) {
    throw new Error('jwks_kid_not_found');
  }
  const key = await importAuth0Jwk(jwk);
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(parts.signature),
    encoder.encode(`${parts.header}.${parts.payload}`),
  );
  if (!verified) {
    throw new Error('invalid_id_token_signature');
  }
  const payload = decodeJsonBase64Url<Auth0IdToken>(parts.payload);
  if (!payload) {
    throw new Error('invalid_id_token_payload');
  }
  const issuer = `https://${env.AUTH0_DOMAIN}/`;
  if (payload.iss !== issuer) {
    throw new Error('invalid_id_token_issuer');
  }
  const audienceOk = Array.isArray(payload.aud)
    ? payload.aud.includes(env.AUTH0_CLIENT_ID)
    : payload.aud === env.AUTH0_CLIENT_ID;
  if (!audienceOk) {
    throw new Error('invalid_id_token_audience');
  }
  if ((payload.exp ?? 0) <= nowSeconds()) {
    throw new Error('id_token_expired');
  }
  if (payload.nonce !== expectedNonce) {
    throw new Error('id_token_nonce_mismatch');
  }
  return payload;
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

async function getEncryptionKey(env: Env) {
  let raw: Uint8Array;
  const configured = env.AUTH_REFRESH_ENCRYPTION_KEY?.trim() ?? '';
  if (configured) {
    raw = base64UrlDecode(configured);
  } else {
    const seed = requireNonEmpty(
      env.SESSION_SECRET || env.MSGSTATS_JWT_SECRET,
      'AUTH_REFRESH_ENCRYPTION_KEY',
    );
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(seed));
    raw = new Uint8Array(digest);
  }
  if (![16, 24, 32].includes(raw.byteLength)) {
    throw new Error('invalid_refresh_encryption_key_length');
  }
  return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

async function encryptRefreshToken(value: string, env: Env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getEncryptionKey(env);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(value),
  );
  return `${base64UrlEncode(iv)}.${base64UrlEncode(encrypted)}`;
}

async function decryptRefreshToken(value: string, env: Env) {
  const [ivText, cipherText] = value.split('.');
  if (!ivText || !cipherText) {
    throw new Error('invalid_refresh_cipher');
  }
  const iv = base64UrlDecode(ivText);
  const cipher = base64UrlDecode(cipherText);
  const key = await getEncryptionKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipher,
  );
  return decoder.decode(decrypted);
}

async function hashSessionHandle(handle: string, env: Env) {
  return await sha256Hex(`${getSessionPepper(env)}:${handle}`);
}

async function issueSessionForUser(
  env: Env,
  input: {
    userId: string;
    orgId: string;
    role: JwtClaims['role'];
    refreshToken: string;
  },
) {
  const now = nowSeconds();
  const sessionHandle = randomBase64Url(48);
  const sessionHandleHash = await hashSessionHandle(sessionHandle, env);
  const refreshTokenEnc = await encryptRefreshToken(input.refreshToken, env);
  await env.DB.prepare(
    `INSERT INTO auth_sessions (session_handle_hash, user_id, refresh_token_enc, active_org_id, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  )
    .bind(
      sessionHandleHash,
      input.userId,
      refreshTokenEnc,
      input.orgId,
      now,
      now,
    )
    .run();
  return sessionHandle;
}

async function resolveUserOrgContext(
  env: Env,
  userId: string,
  orgId?: string | null,
) {
  const membership = orgId
    ? await env.DB.prepare(
        `SELECT m.org_id as orgId, m.role as role
         FROM org_memberships m
         WHERE m.user_id = ? AND m.org_id = ?
         LIMIT 1`,
      )
        .bind(userId, orgId)
        .first<{ orgId: string; role: JwtClaims['role'] }>()
    : await env.DB.prepare(
        `SELECT m.org_id as orgId, m.role as role
         FROM org_memberships m
         WHERE m.user_id = ?
         ORDER BY m.created_at ASC
         LIMIT 1`,
      )
        .bind(userId)
        .first<{ orgId: string; role: JwtClaims['role'] }>();
  if (!membership) {
    return null;
  }
  const user = await env.DB.prepare(
    'SELECT id, email, name FROM users WHERE id = ? LIMIT 1',
  )
    .bind(userId)
    .first<{ id: string; email: string; name: string }>();
  if (!user) {
    return null;
  }
  const metaMapping = await env.DB.prepare(
    'SELECT meta_user_id as metaUserId FROM org_meta_user WHERE user_id = ? AND org_id = ? LIMIT 1',
  )
    .bind(userId, membership.orgId)
    .first<{ metaUserId: string }>();
  return {
    user,
    orgId: membership.orgId,
    role: membership.role,
    metaUserId: metaMapping?.metaUserId ?? null,
  };
}

async function mintAccessToken(
  env: Env,
  input: {
    userId: string;
    orgId: string;
    role: JwtClaims['role'];
    email: string;
    name: string;
    metaUserId?: string | null;
  },
) {
  const now = nowSeconds();
  const exp = now + 60 * 12;
  const claims: JwtClaims = {
    iss: env.MSGSTATS_JWT_ISSUER,
    aud: env.MSGSTATS_JWT_AUDIENCE,
    sub: input.userId,
    org_id: input.orgId,
    role: input.role,
    email: input.email,
    name: input.name,
    ...(input.metaUserId ? { meta_user_id: input.metaUserId } : {}),
    iat: now,
    exp,
    jti: crypto.randomUUID(),
  };
  const token = await signMsgstatsJwt(claims, getJwtSecret(env));
  return { token, expiresIn: exp - now };
}

async function upsertAuth0User(env: Env, profile: Auth0IdToken) {
  const email = (profile.email ?? '').trim().toLowerCase();
  if (!email) {
    throw new Error('auth_email_required');
  }
  const name = deriveDisplayName(profile);
  const auth0Sub = profile.sub;
  if (!auth0Sub) {
    throw new Error('auth_sub_required');
  }
  const now = nowSeconds();
  const existing = await env.DB.prepare(
    'SELECT id, auth0_sub as auth0Sub FROM users WHERE email = ? LIMIT 1',
  )
    .bind(email)
    .first<{ id: string; auth0Sub: string | null }>();
  if (!existing) {
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, auth0_sub, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(userId, email, name, auth0Sub, now, now)
      .run();
    const orgId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
      .bind(orgId, `${name.split(' ')[0] || 'My'} Org`, now, now)
      .run();
    await env.DB.prepare(
      'INSERT INTO org_memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(orgId, userId, 'owner', now)
      .run();
    return { userId };
  }
  if (existing.auth0Sub && existing.auth0Sub !== auth0Sub) {
    throw new Error('auth0_sub_conflict');
  }
  if (!existing.auth0Sub) {
    await env.DB.prepare(
      'UPDATE users SET auth0_sub = ?, updated_at = ? WHERE id = ?',
    )
      .bind(auth0Sub, now, existing.id)
      .run();
  }
  await env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, now, existing.id)
    .run();
  return { userId: existing.id };
}

async function exchangeWithAuth0(
  env: Env,
  body: URLSearchParams,
): Promise<Auth0TokenResponse> {
  const response = await fetch(env.AUTH0_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const result = (await response
    .json()
    .catch(() => ({}))) as Auth0TokenResponse;
  if (!response.ok) {
    throw new Error(result.error ?? `auth0_token_failed_${response.status}`);
  }
  return result;
}

async function redirectWithTokens(
  env: Env,
  req: Request,
  input: {
    returnTo: string;
    accessToken: string;
    sessionHandle: string;
  },
) {
  const redirectTo = `${appOrigin(env, req)}/login#access_token=${encodeURIComponent(
    input.accessToken,
  )}&session_handle=${encodeURIComponent(
    input.sessionHandle,
  )}&return_to=${encodeURIComponent(input.returnTo)}`;
  return Response.redirect(redirectTo, 302);
}

async function buildSessionFromUser(
  env: Env,
  req: Request,
  input: {
    userId: string;
    refreshToken: string;
    returnTo: string;
    orgId?: string | null;
  },
) {
  const context = await resolveUserOrgContext(
    env,
    input.userId,
    input.orgId ?? null,
  );
  if (!context) {
    return json({ error: 'No organization membership found' }, { status: 403 });
  }
  const sessionHandle = await issueSessionForUser(env, {
    userId: context.user.id,
    orgId: context.orgId,
    role: context.role,
    refreshToken: input.refreshToken,
  });
  const access = await mintAccessToken(env, {
    userId: context.user.id,
    orgId: context.orgId,
    role: context.role,
    email: context.user.email,
    name: context.user.name,
    metaUserId: context.metaUserId,
  });
  return await redirectWithTokens(env, req, {
    returnTo: sanitizeReturnTo(input.returnTo),
    accessToken: access.token,
    sessionHandle,
  });
}

async function handleAuthStart(req: Request, env: Env) {
  const url = new URL(req.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get('return_to'));
  const txId = randomBase64Url(24);
  const pkceVerifier = randomBase64Url(64);
  const pkceChallenge = await sha256Base64Url(pkceVerifier);
  const nonce = randomBase64Url(24);
  const createdAt = nowSeconds();
  await env.DB.prepare(
    'INSERT INTO auth_tx (tx_id, pkce_verifier, nonce, return_to, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(txId, pkceVerifier, nonce, returnTo, createdAt)
    .run();
  await env.DB.prepare('DELETE FROM auth_tx WHERE created_at < ?')
    .bind(createdAt - 10 * 60)
    .run();
  const authorizeUrl = new URL(env.AUTH0_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', env.AUTH0_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', env.AUTH0_REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', 'openid profile email offline_access');
  authorizeUrl.searchParams.set('state', txId);
  authorizeUrl.searchParams.set('nonce', nonce);
  authorizeUrl.searchParams.set('code_challenge', pkceChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  if (env.AUTH0_AUDIENCE) {
    authorizeUrl.searchParams.set('audience', env.AUTH0_AUDIENCE);
  }
  return Response.redirect(authorizeUrl.toString(), 302);
}

async function handleAuthCallback(req: Request, env: Env) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=auth_callback_missing_code`,
      302,
    );
  }
  const tx = await env.DB.prepare(
    `SELECT tx_id as txId, pkce_verifier as pkceVerifier, nonce, return_to as returnTo, created_at as createdAt
     FROM auth_tx WHERE tx_id = ? LIMIT 1`,
  )
    .bind(state)
    .first<{
      txId: string;
      pkceVerifier: string;
      nonce: string;
      returnTo: string;
      createdAt: number;
    }>();
  if (!tx || tx.createdAt < nowSeconds() - 10 * 60) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=auth_tx_expired`,
      302,
    );
  }
  await env.DB.prepare('DELETE FROM auth_tx WHERE tx_id = ?').bind(state).run();

  const tokens = await exchangeWithAuth0(
    env,
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.AUTH0_CLIENT_ID,
      code,
      redirect_uri: env.AUTH0_REDIRECT_URI,
      code_verifier: tx.pkceVerifier,
    }),
  );
  if (!tokens.id_token || !tokens.refresh_token) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=auth_tokens_missing`,
      302,
    );
  }
  const profile = await verifyAuth0IdToken(tokens.id_token, env, tx.nonce);
  const mapped = await upsertAuth0User(env, profile);
  return await buildSessionFromUser(env, req, {
    userId: mapped.userId,
    refreshToken: tokens.refresh_token,
    returnTo: tx.returnTo,
  });
}

async function handleAuthRefresh(req: Request, env: Env) {
  const sessionHandle = extractBearer(req.headers);
  if (!sessionHandle) {
    return json({ error: 'Missing session handle' }, { status: 401 });
  }
  const hash = await hashSessionHandle(sessionHandle, env);
  const row = await env.DB.prepare(
    `SELECT session_handle_hash as sessionHandleHash, user_id as userId, refresh_token_enc as refreshTokenEnc, active_org_id as activeOrgId, revoked_at as revokedAt
     FROM auth_sessions
     WHERE session_handle_hash = ?
     LIMIT 1`,
  )
    .bind(hash)
    .first<{
      sessionHandleHash: string;
      userId: string;
      refreshTokenEnc: string;
      activeOrgId: string;
      revokedAt: number | null;
    }>();
  if (!row || row.revokedAt) {
    return json({ error: 'Session not found' }, { status: 401 });
  }

  const refreshToken = await decryptRefreshToken(row.refreshTokenEnc, env);
  let nextRefresh = refreshToken;
  if (!refreshToken.startsWith('fb:')) {
    const refreshed = await exchangeWithAuth0(
      env,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: env.AUTH0_CLIENT_ID,
        refresh_token: refreshToken,
      }),
    );
    nextRefresh = refreshed.refresh_token || refreshToken;
  }
  const nextRefreshEnc = await encryptRefreshToken(nextRefresh, env);
  const context = await resolveUserOrgContext(env, row.userId, row.activeOrgId);
  if (!context) {
    return json({ error: 'No org membership' }, { status: 403 });
  }
  const access = await mintAccessToken(env, {
    userId: context.user.id,
    orgId: context.orgId,
    role: context.role,
    email: context.user.email,
    name: context.user.name,
    metaUserId: context.metaUserId,
  });
  await env.DB.prepare(
    `UPDATE auth_sessions
     SET refresh_token_enc = ?, last_used_at = ?
     WHERE session_handle_hash = ?`,
  )
    .bind(nextRefreshEnc, nowSeconds(), row.sessionHandleHash)
    .run();
  return json({
    access_token: access.token,
    expires_in: access.expiresIn,
    org_id: context.orgId,
    role: context.role,
  });
}

async function handleAuthLogout(req: Request, env: Env) {
  const sessionHandle = extractBearer(req.headers);
  if (!sessionHandle) {
    return new Response(null, { status: 204 });
  }
  const hash = await hashSessionHandle(sessionHandle, env);
  await env.DB.prepare(
    'UPDATE auth_sessions SET revoked_at = ? WHERE session_handle_hash = ? AND revoked_at IS NULL',
  )
    .bind(nowSeconds(), hash)
    .run();
  return new Response(null, { status: 204 });
}

async function handleWhoAmI(req: Request, env: Env) {
  const auth = await requireAccessAuth(req, env);
  if (!auth) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  return json({
    userId: auth.claims.sub,
    orgId: auth.claims.org_id,
    role: auth.claims.role,
    metaUserId: auth.claims.meta_user_id ?? null,
  });
}

async function handleAuthOrgs(req: Request, env: Env) {
  const auth = await requireAccessAuth(req, env);
  if (!auth) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const memberships = await env.DB.prepare(
    `SELECT m.org_id as orgId, m.role as role, o.name as orgName
     FROM org_memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = ?
     ORDER BY o.name ASC`,
  )
    .bind(auth.claims.sub)
    .all<{
      orgId: string;
      role: 'owner' | 'member' | 'coach';
      orgName: string;
    }>();
  return json({
    orgs: memberships.results ?? [],
    active_org_id: auth.claims.org_id,
  });
}

async function handleOrgSwitch(req: Request, env: Env) {
  const sessionHandle = extractBearer(req.headers);
  if (!sessionHandle) {
    return json({ error: 'Missing session handle' }, { status: 401 });
  }
  const body = await readJson<{ org_id?: string }>(req);
  const orgId = body?.org_id?.trim();
  if (!orgId) {
    return json({ error: 'Missing org_id' }, { status: 400 });
  }
  const sessionHash = await hashSessionHandle(sessionHandle, env);
  const session = await env.DB.prepare(
    `SELECT session_handle_hash as sessionHandleHash, user_id as userId, refresh_token_enc as refreshTokenEnc, revoked_at as revokedAt
     FROM auth_sessions
     WHERE session_handle_hash = ?
     LIMIT 1`,
  )
    .bind(sessionHash)
    .first<{
      sessionHandleHash: string;
      userId: string;
      refreshTokenEnc: string;
      revokedAt: number | null;
    }>();
  if (!session || session.revokedAt) {
    return json({ error: 'Session not found' }, { status: 401 });
  }
  const context = await resolveUserOrgContext(env, session.userId, orgId);
  if (!context) {
    return json({ error: 'Organization not accessible' }, { status: 403 });
  }
  const access = await mintAccessToken(env, {
    userId: context.user.id,
    orgId: context.orgId,
    role: context.role,
    email: context.user.email,
    name: context.user.name,
    metaUserId: context.metaUserId,
  });
  await env.DB.prepare(
    `UPDATE auth_sessions
     SET active_org_id = ?, last_used_at = ?
     WHERE session_handle_hash = ?`,
  )
    .bind(context.orgId, nowSeconds(), session.sessionHandleHash)
    .run();
  return json({
    access_token: access.token,
    expires_in: access.expiresIn,
    org_id: context.orgId,
    role: context.role,
  });
}

async function handleAuthMe(req: Request, env: Env) {
  const auth = await requireAccessAuth(req, env);
  if (!auth) {
    return json({ authenticated: false });
  }
  return json({
    authenticated: true,
    userId: auth.claims.sub,
    orgId: auth.claims.org_id,
    role: auth.claims.role,
    name: auth.claims.name,
    email: auth.claims.email,
    metaUserId: auth.claims.meta_user_id ?? null,
  });
}

async function handleInviteAccept(req: Request, env: Env) {
  const auth = await requireAccessAuth(req, env);
  if (!auth) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await readJson<{ token?: string }>(req);
  const token = body?.token?.trim();
  if (!token) {
    return json({ error: 'Missing token' }, { status: 400 });
  }
  const tokenHash = await sha256Hex(`${getInvitePepper(env)}:${token}`);
  const invite = await env.DB.prepare(
    `SELECT id, org_id as orgId, role, expires_at as expiresAt, accepted_at as acceptedAt
     FROM org_invites
     WHERE token_hash = ?
     LIMIT 1`,
  )
    .bind(tokenHash)
    .first<{
      id: string;
      orgId: string;
      role: JwtClaims['role'];
      expiresAt: number;
      acceptedAt: number | null;
    }>();
  if (!invite || invite.acceptedAt || invite.expiresAt <= nowSeconds()) {
    return json({ error: 'Invite invalid or expired' }, { status: 400 });
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO org_memberships (org_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(invite.orgId, auth.claims.sub, invite.role, nowSeconds())
    .run();
  await env.DB.prepare('UPDATE org_invites SET accepted_at = ? WHERE id = ?')
    .bind(nowSeconds(), invite.id)
    .run();
  return json({ org_id: invite.orgId });
}

async function handleMetaLogin(req: Request, env: Env) {
  const returnTo = sanitizeReturnTo(
    new URL(req.url).searchParams.get('return_to'),
  );
  const auth = await requireAccessAuth(req, env);
  const statePayloadObject: {
    returnTo: string;
    issuedAt: number;
    linkUserId?: string;
    linkOrgId?: string;
  } = {
    returnTo,
    issuedAt: nowSeconds(),
  };
  if (auth) {
    statePayloadObject.linkUserId = auth.claims.sub;
    statePayloadObject.linkOrgId = auth.claims.org_id;
  }
  const statePayload = base64UrlEncode(
    encoder.encode(JSON.stringify(statePayloadObject)),
  );
  const stateSignature = await hmacSha256Base64Url(
    `meta:${statePayload}`,
    getStateSigningSecret(env),
  );
  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  url.searchParams.set('client_id', env.META_APP_ID);
  url.searchParams.set('redirect_uri', env.META_REDIRECT_URI);
  url.searchParams.set('state', `${statePayload}.${stateSignature}`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set(
    'scope',
    'pages_manage_metadata,pages_read_engagement,pages_show_list,instagram_basic',
  );
  url.searchParams.set('auth_type', 'rerequest');
  return Response.redirect(url.toString(), 302);
}

async function ensureOrgForLegacyMeta(
  env: Env,
  input: { metaUserId: string; email: string; name: string; orgName: string },
) {
  const now = nowSeconds();
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('email_required');
  }
  let user = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
  )
    .bind(normalizedEmail)
    .first<{ id: string }>();
  if (!user) {
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(userId, normalizedEmail, input.name, now, now)
      .run();
    user = { id: userId };
  }
  let membership = await env.DB.prepare(
    'SELECT org_id as orgId, role FROM org_memberships WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
  )
    .bind(user.id)
    .first<{ orgId: string; role: JwtClaims['role'] }>();
  if (!membership) {
    const orgId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
      .bind(orgId, input.orgName, now, now)
      .run();
    await env.DB.prepare(
      'INSERT INTO org_memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(orgId, user.id, 'owner', now)
      .run();
    membership = { orgId, role: 'owner' };
  }
  await env.DB.prepare(
    `INSERT INTO org_meta_user (org_id, user_id, meta_user_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(meta_user_id) DO UPDATE SET org_id = excluded.org_id, user_id = excluded.user_id`,
  )
    .bind(membership.orgId, user.id, input.metaUserId, now)
    .run();

  const tableStatements = [
    'UPDATE meta_pages SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
    'UPDATE ig_assets SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
    'UPDATE conversations SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
    'UPDATE messages SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
    'UPDATE sync_states SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
    'UPDATE sync_runs SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
    'UPDATE conversation_tags SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
    'UPDATE saved_responses SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
    'UPDATE conversation_state_events SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
    'UPDATE meta_custom_labels_cache SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
    'UPDATE followup_events SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
  ];
  for (const statement of tableStatements) {
    await env.DB.prepare(statement)
      .bind(membership.orgId, input.metaUserId)
      .run();
  }
  return { userId: user.id, orgId: membership.orgId };
}

async function handleMetaCallback(req: Request, env: Env) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  let returnTo = '/';
  let linkUserId: string | null = null;
  let linkOrgId: string | null = null;
  if (state?.includes('.')) {
    const [encodedPayload, signature] = state.split('.');
    if (encodedPayload && signature) {
      const expectedSignature = await hmacSha256Base64Url(
        `meta:${encodedPayload}`,
        getStateSigningSecret(env),
      );
      if (expectedSignature === signature) {
        try {
          const payload = JSON.parse(
            decoder.decode(base64UrlDecode(encodedPayload)),
          ) as {
            returnTo?: string;
            linkUserId?: string;
            linkOrgId?: string;
            issuedAt?: number;
          };
          returnTo = sanitizeReturnTo(payload.returnTo ?? '/');
          linkUserId = payload.linkUserId ?? null;
          linkOrgId = payload.linkOrgId ?? null;
        } catch {
          returnTo = '/';
        }
      } else {
        // backward-compatible fallback for old `nonce.base64url(return_to)` format
        try {
          const decoded = decoder.decode(base64UrlDecode(signature));
          returnTo = sanitizeReturnTo(decoded);
        } catch {
          returnTo = '/';
        }
      }
    }
  }
  if (!code) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=meta_missing_code`,
      302,
    );
  }

  const shortToken = await exchangeCodeForToken({
    env,
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    redirectUri: env.META_REDIRECT_URI,
    code,
    version: getMetaApiVersion(env),
  });
  const longToken = await exchangeForLongLivedToken({
    env,
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    accessToken: shortToken.accessToken,
    version: getMetaApiVersion(env),
  });
  const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
  const debug = await debugToken({
    env,
    inputToken: longToken.accessToken,
    appToken,
    version: getMetaApiVersion(env),
  });
  if (!debug?.user_id || !debug?.is_valid) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=meta_token_invalid`,
      302,
    );
  }

  const metaUserId = debug.user_id;
  const expiresAt =
    debug.expires_at && debug.expires_at > 0
      ? debug.expires_at
      : longToken.expiresIn
        ? nowSeconds() + longToken.expiresIn
        : null;
  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO meta_users (id, access_token, token_type, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM meta_users WHERE id = ?), ?), ?)`,
  )
    .bind(
      metaUserId,
      longToken.accessToken,
      longToken.tokenType ?? shortToken.tokenType ?? null,
      expiresAt,
      metaUserId,
      nowIso,
      nowIso,
    )
    .run();

  const mapping = await env.DB.prepare(
    'SELECT user_id as userId, org_id as orgId FROM org_meta_user WHERE meta_user_id = ? LIMIT 1',
  )
    .bind(metaUserId)
    .first<{ userId: string; orgId: string }>();

  let profileName = `Meta user ${metaUserId.slice(0, 6)}`;
  try {
    const profile = await fetchUserProfile({
      env,
      accessToken: longToken.accessToken,
      version: getMetaApiVersion(env),
      workspaceId: metaUserId,
    });
    if (profile?.name) {
      profileName = profile.name;
    }
  } catch {
    // best effort
  }

  if (!mapping) {
    if (linkUserId && linkOrgId) {
      const membership = await env.DB.prepare(
        `SELECT org_id as orgId
         FROM org_memberships
         WHERE org_id = ? AND user_id = ?
         LIMIT 1`,
      )
        .bind(linkOrgId, linkUserId)
        .first<{ orgId: string }>();
      if (membership) {
        await env.DB.prepare(
          `INSERT INTO org_meta_user (org_id, user_id, meta_user_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(meta_user_id) DO UPDATE SET
             org_id = excluded.org_id,
             user_id = excluded.user_id`,
        )
          .bind(linkOrgId, linkUserId, metaUserId, nowSeconds())
          .run();
        await env.DB.prepare(
          'UPDATE meta_pages SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
        )
          .bind(linkOrgId, metaUserId)
          .run();
        await env.DB.prepare(
          'UPDATE ig_assets SET org_id = ? WHERE user_id = ? AND (org_id IS NULL OR org_id = "")',
        )
          .bind(linkOrgId, metaUserId)
          .run();
        return Response.redirect(`${appOrigin(env, req)}${returnTo}`, 302);
      }
    }
    const pendingToken = randomBase64Url(32);
    const hasLegacyData = !!(await env.DB.prepare(
      'SELECT id FROM meta_users WHERE id = ? LIMIT 1',
    )
      .bind(metaUserId)
      .first<{ id: string }>());
    await env.DB.prepare(
      `INSERT INTO auth_pending_meta (token, meta_user_id, suggested_name, suggested_org_name, mode, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        pendingToken,
        metaUserId,
        profileName,
        `${profileName.split(' ')[0] || 'My'} Org`,
        hasLegacyData ? 'migrate' : 'create',
        nowSeconds(),
        nowSeconds() + 15 * 60,
      )
      .run();
    return Response.redirect(
      `${appOrigin(env, req)}/login?meta_setup=1#meta_setup_token=${encodeURIComponent(
        pendingToken,
      )}`,
      302,
    );
  }

  const user = await env.DB.prepare(
    'SELECT id, email, name FROM users WHERE id = ? LIMIT 1',
  )
    .bind(mapping.userId)
    .first<{ id: string; email: string; name: string }>();
  if (!user?.email) {
    const pendingToken = randomBase64Url(32);
    await env.DB.prepare(
      `INSERT INTO auth_pending_meta (token, meta_user_id, suggested_name, suggested_org_name, mode, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'link', ?, ?)`,
    )
      .bind(
        pendingToken,
        metaUserId,
        profileName,
        `${profileName.split(' ')[0] || 'My'} Org`,
        nowSeconds(),
        nowSeconds() + 15 * 60,
      )
      .run();
    return Response.redirect(
      `${appOrigin(env, req)}/login?meta_setup=1#meta_setup_token=${encodeURIComponent(
        pendingToken,
      )}`,
      302,
    );
  }

  if (returnTo && returnTo !== '/') {
    return Response.redirect(`${appOrigin(env, req)}${returnTo}`, 302);
  }

  const refreshSeed = `fb:${metaUserId}`;
  return await buildSessionFromUser(env, req, {
    userId: mapping.userId,
    orgId: mapping.orgId,
    refreshToken: refreshSeed,
    returnTo,
  });
}

async function handleMetaSetupComplete(req: Request, env: Env) {
  const body = await readJson<{
    token?: string;
    email?: string;
    name?: string;
    org_name?: string;
  }>(req);
  const token = body?.token?.trim();
  const email = body?.email?.trim().toLowerCase();
  const name = body?.name?.trim();
  const orgName = body?.org_name?.trim();
  if (!token || !email || !name || !orgName) {
    return json(
      { error: 'token, email, name, org_name are required' },
      { status: 400 },
    );
  }
  const pending = await env.DB.prepare(
    `SELECT token, meta_user_id as metaUserId, expires_at as expiresAt
     FROM auth_pending_meta
     WHERE token = ?
     LIMIT 1`,
  )
    .bind(token)
    .first<{ token: string; metaUserId: string; expiresAt: number }>();
  if (!pending || pending.expiresAt <= nowSeconds()) {
    return json({ error: 'Setup token expired' }, { status: 400 });
  }
  const existingEmail = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
  )
    .bind(email)
    .first<{ id: string }>();
  if (existingEmail) {
    return json(
      {
        error:
          'Email already exists. Sign in and link this Meta account from settings.',
        code: 'email_exists',
      },
      { status: 409 },
    );
  }
  const mapped = await ensureOrgForLegacyMeta(env, {
    metaUserId: pending.metaUserId,
    email,
    name,
    orgName,
  });
  await env.DB.prepare('DELETE FROM auth_pending_meta WHERE token = ?')
    .bind(token)
    .run();
  const access = await mintAccessToken(env, {
    userId: mapped.userId,
    orgId: mapped.orgId,
    role: 'owner',
    email,
    name,
    metaUserId: pending.metaUserId,
  });
  const sessionHandle = await issueSessionForUser(env, {
    userId: mapped.userId,
    orgId: mapped.orgId,
    role: 'owner',
    refreshToken: `fb:${pending.metaUserId}`,
  });
  return json({
    access_token: access.token,
    session_handle: sessionHandle,
    return_to: '/',
  });
}

export async function requireAccessAuth(
  req: Request,
  env: Env,
): Promise<AuthContext | null> {
  const token = extractBearer(req.headers);
  if (!token) return null;
  const claims = await verifyMsgstatsJwt(token, env);
  if (!claims) return null;
  const membership = await env.DB.prepare(
    'SELECT role FROM org_memberships WHERE org_id = ? AND user_id = ? LIMIT 1',
  )
    .bind(claims.org_id, claims.sub)
    .first<{ role: JwtClaims['role'] }>();
  if (!membership) {
    return null;
  }
  return { token, claims: { ...claims, role: membership.role } };
}

export async function handleAuthGateway(
  req: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (method === 'GET' && path === '/auth/start') {
    return await handleAuthStart(req, env);
  }
  if (method === 'GET' && path === '/auth/callback') {
    return await handleAuthCallback(req, env);
  }
  if (method === 'POST' && path === '/auth/refresh') {
    return await handleAuthRefresh(req, env);
  }
  if (method === 'POST' && path === '/auth/logout') {
    return await handleAuthLogout(req, env);
  }
  if (method === 'POST' && path === '/auth/invite/accept') {
    return await handleInviteAccept(req, env);
  }

  if (method === 'GET' && path === '/api/auth/login') {
    return await handleMetaLogin(req, env);
  }
  if (method === 'GET' && path === '/api/auth/callback') {
    return await handleMetaCallback(req, env);
  }
  if (method === 'POST' && path === '/api/auth/meta/setup') {
    return await handleMetaSetupComplete(req, env);
  }
  if (method === 'GET' && path === '/api/auth/me') {
    return await handleAuthMe(req, env);
  }
  if (method === 'GET' && path === '/api/auth/whoami') {
    return await handleWhoAmI(req, env);
  }
  if (method === 'GET' && path === '/api/auth/orgs') {
    return await handleAuthOrgs(req, env);
  }
  if (method === 'POST' && path === '/auth/org/switch') {
    return await handleOrgSwitch(req, env);
  }
  if (method === 'POST' && path === '/api/auth/org/switch') {
    return await handleOrgSwitch(req, env);
  }
  if (method === 'POST' && path === '/api/auth/logout') {
    return await handleAuthLogout(req, env);
  }

  return null;
}
