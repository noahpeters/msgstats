import type { Env } from './worker';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
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
  amr?: string[];
  bootstrap?: boolean;
  iat: number;
  exp: number;
  jti: string;
};

type AuthContext = {
  claims: JwtClaims;
  token: string;
};

type Jwk = {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
};

type JwksResponse = {
  keys?: Jwk[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const jwksCache = new Map<string, { fetchedAt: number; keys: Jwk[] }>();

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
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

function requireNonEmpty(value: string | undefined | null, key: string) {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(`missing_env_${key}`);
  }
  return normalized;
}

function appOrigin(env: Env, req: Request) {
  return env.APP_ORIGIN ?? new URL(req.url).origin;
}

function sanitizeReturnTo(value: string | null) {
  if (!value) return '/';
  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }
  return '/';
}

type SocialProvider = 'google' | 'apple';
const SOCIAL_PROVIDERS: SocialProvider[] = ['google', 'apple'];

function getAllowedSocialProviders(env: Env): Set<SocialProvider> {
  const raw = env.SOCIAL_LOGIN;
  if (raw === undefined) {
    return new Set(SOCIAL_PROVIDERS);
  }
  const allowed = new Set<SocialProvider>();
  for (const entry of raw.split(',')) {
    const normalized = entry.trim().toLowerCase();
    if (normalized === 'google' || normalized === 'apple') {
      allowed.add(normalized);
    }
  }
  return allowed;
}

function isSocialProviderEnabled(env: Env, provider: SocialProvider) {
  return getAllowedSocialProviders(env).has(provider);
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

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return base64UrlEncode(digest);
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

async function signMsgstatsJwt(claims: JwtClaims, secret: string) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const encodedClaims = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const payload = `${encodedHeader}.${encodedClaims}`;
  const signature = await hmacSha256Base64Url(payload, secret);
  return `${payload}.${signature}`;
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

function getPasswordResetPepper(env: Env) {
  return requireNonEmpty(
    env.AUTH_PASSWORD_RESET_PEPPER ||
      env.AUTH_INVITE_PEPPER ||
      env.SESSION_SECRET,
    'AUTH_PASSWORD_RESET_PEPPER',
  );
}

function getStateSigningSecret(env: Env) {
  return requireNonEmpty(
    env.SESSION_SECRET || env.MSGSTATS_JWT_SECRET,
    'SESSION_SECRET',
  );
}

function getPasswordIterations(env: Env) {
  const parsed = Number(env.AUTH_PBKDF2_ITERATIONS ?? 210000);
  if (!Number.isFinite(parsed) || parsed < 100000) {
    return 210000;
  }
  return Math.floor(parsed);
}

function getMetaApiVersion(env: Env) {
  return env.META_API_VERSION ?? 'v19.0';
}

function extractBearer(headers: Headers) {
  const header = headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return header.slice(7).trim();
}

function readJson<T>(req: Request): Promise<T | null> {
  return req
    .json<T>()
    .then((value) => value)
    .catch(() => null);
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

async function encryptSecret(value: string, env: Env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getEncryptionKey(env);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(value),
  );
  return `${base64UrlEncode(iv)}.${base64UrlEncode(encrypted)}`;
}

async function decryptSecret(value: string, env: Env) {
  const [ivText, cipherText] = value.split('.');
  if (!ivText || !cipherText) {
    throw new Error('invalid_secret_cipher');
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

async function hashPassword(
  password: string,
  salt: string,
  iterations: number,
) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64UrlDecode(salt),
      iterations,
    },
    key,
    256,
  );
  return base64UrlEncode(bits);
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function issueSessionForUser(
  env: Env,
  input: {
    userId: string;
    orgId: string;
    continuationSecret: string;
    isBootstrap?: boolean;
    bootstrapExpiresAt?: number | null;
  },
) {
  const now = nowSeconds();
  const sessionHandle = randomBase64Url(48);
  const sessionHandleHash = await hashSessionHandle(sessionHandle, env);
  const refreshTokenEnc = await encryptSecret(input.continuationSecret, env);
  await env.DB.prepare(
    `INSERT INTO auth_sessions (
      session_handle_hash,
      user_id,
      refresh_token_enc,
      active_org_id,
      created_at,
      last_used_at,
      revoked_at,
      is_bootstrap,
      bootstrap_expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      sessionHandleHash,
      input.userId,
      refreshTokenEnc,
      input.orgId,
      now,
      now,
      input.isBootstrap ? 1 : 0,
      input.bootstrapExpiresAt ?? null,
    )
    .run();
  return sessionHandle;
}

async function revokeBootstrapSessions(env: Env, userId: string) {
  await env.DB.prepare(
    `UPDATE auth_sessions
     SET revoked_at = ?
     WHERE user_id = ?
       AND is_bootstrap = 1
       AND revoked_at IS NULL`,
  )
    .bind(nowSeconds(), userId)
    .run();
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
    'SELECT id, email, name, auth_ready_at as authReadyAt FROM users WHERE id = ? LIMIT 1',
  )
    .bind(userId)
    .first<{
      id: string;
      email: string;
      name: string;
      authReadyAt: number | null;
    }>();
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
    bootstrap?: boolean;
    amr?: string[];
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
    ...(input.amr?.length ? { amr: input.amr } : {}),
    ...(input.bootstrap ? { bootstrap: true } : {}),
    iat: now,
    exp,
    jti: crypto.randomUUID(),
  };
  const token = await signMsgstatsJwt(claims, getJwtSecret(env));
  return { token, expiresIn: exp - now };
}

async function redirectWithTokens(
  env: Env,
  req: Request,
  input: {
    returnTo: string;
    accessToken: string;
    sessionHandle: string;
    needsCredentialSetup?: boolean;
  },
) {
  const redirectTo = `${appOrigin(env, req)}/login#access_token=${encodeURIComponent(
    input.accessToken,
  )}&session_handle=${encodeURIComponent(
    input.sessionHandle,
  )}&return_to=${encodeURIComponent(input.returnTo)}${
    input.needsCredentialSetup ? '&needs_credential_setup=1' : ''
  }`;
  return Response.redirect(redirectTo, 302);
}

async function ensureUserHasOrg(env: Env, userId: string, nameHint: string) {
  const existing = await env.DB.prepare(
    'SELECT org_id as orgId FROM org_memberships WHERE user_id = ? LIMIT 1',
  )
    .bind(userId)
    .first<{ orgId: string }>();
  if (existing) {
    return existing.orgId;
  }
  const now = nowSeconds();
  const orgId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
  )
    .bind(orgId, `${nameHint.split(' ')[0] || 'My'} Org`, now, now)
    .run();
  await env.DB.prepare(
    'INSERT INTO org_memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(orgId, userId, 'owner', now)
    .run();
  return orgId;
}

async function upsertUserIdentity(
  env: Env,
  input: {
    provider: 'google' | 'apple';
    providerSub: string;
    email: string | null;
    name: string | null;
  },
) {
  const existingIdentity = await env.DB.prepare(
    `SELECT user_id as userId
     FROM user_identities
     WHERE provider = ? AND provider_sub = ?
     LIMIT 1`,
  )
    .bind(input.provider, input.providerSub)
    .first<{ userId: string }>();

  const now = nowSeconds();
  if (existingIdentity) {
    const user = await env.DB.prepare(
      'SELECT id, email, name FROM users WHERE id = ? LIMIT 1',
    )
      .bind(existingIdentity.userId)
      .first<{ id: string; email: string; name: string }>();
    if (!user) {
      throw new Error('identity_user_missing');
    }
    await ensureUserHasOrg(env, user.id, user.name);
    await env.DB.prepare(
      'UPDATE users SET updated_at = ?, auth_ready_at = COALESCE(auth_ready_at, ?) WHERE id = ?',
    )
      .bind(now, now, user.id)
      .run();
    return { userId: user.id };
  }

  const normalizedEmail = (input.email ?? '').trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('oauth_email_required');
  }
  const displayName =
    input.name?.trim() || normalizedEmail.split('@')[0] || 'msgstats user';

  let user = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
  )
    .bind(normalizedEmail)
    .first<{ id: string }>();

  if (!user) {
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, auth_ready_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(userId, normalizedEmail, displayName, now, now, now)
      .run();
    user = { id: userId };
  } else {
    await env.DB.prepare(
      'UPDATE users SET auth_ready_at = COALESCE(auth_ready_at, ?), updated_at = ? WHERE id = ?',
    )
      .bind(now, now, user.id)
      .run();
  }

  await env.DB.prepare(
    `INSERT INTO user_identities (provider, provider_sub, user_id, email, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_sub) DO UPDATE SET
       user_id = excluded.user_id,
       email = excluded.email`,
  )
    .bind(input.provider, input.providerSub, user.id, normalizedEmail, now)
    .run();

  await ensureUserHasOrg(env, user.id, displayName);
  return { userId: user.id };
}

async function loadJwks(url: string): Promise<Jwk[]> {
  const now = Date.now();
  const cached = jwksCache.get(url);
  if (cached && now - cached.fetchedAt < 5 * 60 * 1000) {
    return cached.keys;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`jwks_fetch_failed_${res.status}`);
  }
  const body = (await res.json()) as JwksResponse;
  const keys = body.keys ?? [];
  jwksCache.set(url, { fetchedAt: now, keys });
  return keys;
}

async function importRsaJwk(jwk: Jwk) {
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

async function verifyOidcIdToken(input: {
  idToken: string;
  jwksUrl: string;
  expectedNonce: string;
  expectedAudience: string;
  allowedIssuers: string[];
}) {
  const parts = parseJwtParts(input.idToken);
  if (!parts) {
    throw new Error('invalid_id_token_format');
  }
  const header = decodeJsonBase64Url<{ kid?: string; alg?: string }>(
    parts.header,
  );
  if (!header?.kid || header.alg !== 'RS256') {
    throw new Error('invalid_id_token_header');
  }
  const keys = await loadJwks(input.jwksUrl);
  const jwk = keys.find((item) => item.kid === header.kid);
  if (!jwk) {
    throw new Error('id_token_kid_not_found');
  }
  const key = await importRsaJwk(jwk);
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(parts.signature),
    encoder.encode(`${parts.header}.${parts.payload}`),
  );
  if (!verified) {
    throw new Error('invalid_id_token_signature');
  }

  const payload = decodeJsonBase64Url<{
    iss?: string;
    aud?: string | string[];
    exp?: number;
    nonce?: string;
    sub?: string;
    email?: string;
    name?: string;
  }>(parts.payload);
  if (!payload?.sub) {
    throw new Error('invalid_id_token_payload');
  }
  if (!payload.iss || !input.allowedIssuers.includes(payload.iss)) {
    throw new Error('invalid_id_token_issuer');
  }
  const audienceOk = Array.isArray(payload.aud)
    ? payload.aud.includes(input.expectedAudience)
    : payload.aud === input.expectedAudience;
  if (!audienceOk) {
    throw new Error('invalid_id_token_audience');
  }
  if ((payload.exp ?? 0) <= nowSeconds()) {
    throw new Error('id_token_expired');
  }
  if (payload.nonce !== input.expectedNonce) {
    throw new Error('id_token_nonce_mismatch');
  }
  return payload;
}

async function createOauthTx(
  env: Env,
  input: { provider: 'google' | 'apple'; returnTo: string },
) {
  const txId = randomBase64Url(24);
  const pkceVerifier = randomBase64Url(64);
  const nonce = randomBase64Url(24);
  const createdAt = nowSeconds();
  await env.DB.prepare(
    `INSERT INTO auth_tx (tx_id, provider, pkce_verifier, nonce, return_to, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(txId, input.provider, pkceVerifier, nonce, input.returnTo, createdAt)
    .run();
  await env.DB.prepare('DELETE FROM auth_tx WHERE created_at < ?')
    .bind(createdAt - 10 * 60)
    .run();
  return {
    txId,
    pkceVerifier,
    nonce,
    codeChallenge: await sha256Base64Url(pkceVerifier),
  };
}

async function consumeOauthTx(
  env: Env,
  input: { state: string; provider: 'google' | 'apple' },
) {
  const tx = await env.DB.prepare(
    `SELECT tx_id as txId, provider, pkce_verifier as pkceVerifier, nonce, return_to as returnTo, created_at as createdAt
     FROM auth_tx
     WHERE tx_id = ?
     LIMIT 1`,
  )
    .bind(input.state)
    .first<{
      txId: string;
      provider: string | null;
      pkceVerifier: string;
      nonce: string;
      returnTo: string;
      createdAt: number;
    }>();
  if (!tx || tx.createdAt < nowSeconds() - 10 * 60) {
    return null;
  }
  if ((tx.provider ?? input.provider) !== input.provider) {
    return null;
  }
  await env.DB.prepare('DELETE FROM auth_tx WHERE tx_id = ?')
    .bind(input.state)
    .run();
  return tx;
}

async function finalizeLoginSession(
  env: Env,
  req: Request,
  input: {
    userId: string;
    returnTo: string;
    amr: string[];
    isBootstrap?: boolean;
    bootstrapTtlSec?: number;
  },
) {
  const context = await resolveUserOrgContext(env, input.userId, null);
  if (!context) {
    return json({ error: 'No organization membership found' }, { status: 403 });
  }
  const continuationSecret = `cont:${randomBase64Url(24)}`;
  const bootstrapExpiresAt = input.isBootstrap
    ? nowSeconds() + (input.bootstrapTtlSec ?? 30 * 60)
    : null;
  const sessionHandle = await issueSessionForUser(env, {
    userId: context.user.id,
    orgId: context.orgId,
    continuationSecret,
    isBootstrap: input.isBootstrap,
    bootstrapExpiresAt,
  });
  const access = await mintAccessToken(env, {
    userId: context.user.id,
    orgId: context.orgId,
    role: context.role,
    email: context.user.email,
    name: context.user.name,
    metaUserId: context.metaUserId,
    amr: input.amr,
    bootstrap: input.isBootstrap,
  });
  return await redirectWithTokens(env, req, {
    returnTo: sanitizeReturnTo(input.returnTo),
    accessToken: access.token,
    sessionHandle,
    needsCredentialSetup: Boolean(input.isBootstrap),
  });
}

async function handleGoogleStart(req: Request, env: Env) {
  if (!isSocialProviderEnabled(env, 'google')) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=social_login_disabled`,
      302,
    );
  }
  const returnTo = sanitizeReturnTo(
    new URL(req.url).searchParams.get('return_to'),
  );
  const tx = await createOauthTx(env, { provider: 'google', returnTo });
  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'openid email profile');
  authorizeUrl.searchParams.set('state', tx.txId);
  authorizeUrl.searchParams.set('nonce', tx.nonce);
  authorizeUrl.searchParams.set('code_challenge', tx.codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  return Response.redirect(authorizeUrl.toString(), 302);
}

async function handleGoogleCallback(req: Request, env: Env) {
  if (!isSocialProviderEnabled(env, 'google')) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=social_login_disabled`,
      302,
    );
  }
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=oauth_missing_code`,
      302,
    );
  }
  const tx = await consumeOauthTx(env, { state, provider: 'google' });
  if (!tx) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=oauth_tx_expired`,
      302,
    );
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      code_verifier: tx.pkceVerifier,
    }),
  });
  const tokens = (await tokenRes.json().catch(() => ({}))) as {
    id_token?: string;
  };
  if (!tokenRes.ok || !tokens.id_token) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=oauth_token_failed`,
      302,
    );
  }

  const idToken = await verifyOidcIdToken({
    idToken: tokens.id_token,
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    expectedNonce: tx.nonce,
    expectedAudience: env.GOOGLE_CLIENT_ID,
    allowedIssuers: ['https://accounts.google.com', 'accounts.google.com'],
  });

  const mapped = await upsertUserIdentity(env, {
    provider: 'google',
    providerSub: idToken.sub ?? '',
    email: idToken.email ?? null,
    name: idToken.name ?? null,
  });

  return await finalizeLoginSession(env, req, {
    userId: mapped.userId,
    returnTo: tx.returnTo,
    amr: ['oauth_google'],
  });
}

function parseApplePrivateKeyPem(raw: string) {
  const body = raw
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  return base64UrlDecode(body.replace(/\+/g, '-').replace(/\//g, '_'));
}

async function signAppleClientSecret(env: Env) {
  const now = nowSeconds();
  const header = {
    alg: 'ES256',
    kid: env.APPLE_KEY_ID,
    typ: 'JWT',
  };
  const payload = {
    iss: env.APPLE_TEAM_ID,
    iat: now,
    exp: now + 5 * 60,
    aud: 'https://appleid.apple.com',
    sub: env.APPLE_CLIENT_ID,
  };
  const encodedHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    parseApplePrivateKeyPem(env.APPLE_PRIVATE_KEY_P8),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function handleAppleStart(req: Request, env: Env) {
  if (!isSocialProviderEnabled(env, 'apple')) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=social_login_disabled`,
      302,
    );
  }
  const returnTo = sanitizeReturnTo(
    new URL(req.url).searchParams.get('return_to'),
  );
  const tx = await createOauthTx(env, { provider: 'apple', returnTo });
  const authorizeUrl = new URL('https://appleid.apple.com/auth/authorize');
  authorizeUrl.searchParams.set('client_id', env.APPLE_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', env.APPLE_REDIRECT_URI);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'name email');
  authorizeUrl.searchParams.set('state', tx.txId);
  authorizeUrl.searchParams.set('nonce', tx.nonce);
  authorizeUrl.searchParams.set('response_mode', 'form_post');
  return Response.redirect(authorizeUrl.toString(), 302);
}

async function readAppleCallbackParams(req: Request) {
  if (req.method.toUpperCase() === 'POST') {
    const form = await req.formData().catch(() => null);
    return {
      code: form?.get('code')?.toString() ?? null,
      state: form?.get('state')?.toString() ?? null,
      userJson: form?.get('user')?.toString() ?? null,
    };
  }
  const url = new URL(req.url);
  return {
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    userJson: null,
  };
}

async function handleAppleCallback(req: Request, env: Env) {
  if (!isSocialProviderEnabled(env, 'apple')) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=social_login_disabled`,
      302,
    );
  }
  const { code, state, userJson } = await readAppleCallbackParams(req);
  if (!code || !state) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=oauth_missing_code`,
      302,
    );
  }
  const tx = await consumeOauthTx(env, { state, provider: 'apple' });
  if (!tx) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=oauth_tx_expired`,
      302,
    );
  }

  const clientSecret = await signAppleClientSecret(env);
  const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env.APPLE_CLIENT_ID,
      client_secret: clientSecret,
      redirect_uri: env.APPLE_REDIRECT_URI,
    }),
  });
  const tokens = (await tokenRes.json().catch(() => ({}))) as {
    id_token?: string;
  };
  if (!tokenRes.ok || !tokens.id_token) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=oauth_token_failed`,
      302,
    );
  }

  const idToken = await verifyOidcIdToken({
    idToken: tokens.id_token,
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    expectedNonce: tx.nonce,
    expectedAudience: env.APPLE_CLIENT_ID,
    allowedIssuers: ['https://appleid.apple.com'],
  });

  let parsedUserName: string | null = null;
  if (userJson) {
    try {
      const parsed = JSON.parse(userJson) as {
        name?: { firstName?: string; lastName?: string };
      };
      const full =
        `${parsed?.name?.firstName ?? ''} ${parsed?.name?.lastName ?? ''}`.trim();
      parsedUserName = full || null;
    } catch {
      parsedUserName = null;
    }
  }

  const existingIdentity = await env.DB.prepare(
    `SELECT user_id as userId
     FROM user_identities
     WHERE provider = 'apple' AND provider_sub = ?
     LIMIT 1`,
  )
    .bind(idToken.sub ?? '')
    .first<{ userId: string }>();

  if (!existingIdentity && !(idToken.email ?? '').trim()) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=apple_email_required_for_first_login`,
      302,
    );
  }

  const mapped = await upsertUserIdentity(env, {
    provider: 'apple',
    providerSub: idToken.sub ?? '',
    email: idToken.email ?? null,
    name: parsedUserName ?? idToken.name ?? null,
  });

  return await finalizeLoginSession(env, req, {
    userId: mapped.userId,
    returnTo: tx.returnTo,
    amr: ['oauth_apple'],
  });
}

async function handleAuthRefresh(req: Request, env: Env) {
  const sessionHandle = extractBearer(req.headers);
  if (!sessionHandle) {
    return json({ error: 'Missing session handle' }, { status: 401 });
  }
  const hash = await hashSessionHandle(sessionHandle, env);
  const row = await env.DB.prepare(
    `SELECT session_handle_hash as sessionHandleHash,
            user_id as userId,
            refresh_token_enc as refreshTokenEnc,
            active_org_id as activeOrgId,
            revoked_at as revokedAt,
            is_bootstrap as isBootstrap,
            bootstrap_expires_at as bootstrapExpiresAt
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
      isBootstrap: number;
      bootstrapExpiresAt: number | null;
    }>();
  if (!row || row.revokedAt) {
    return json({ error: 'Session not found' }, { status: 401 });
  }

  if (
    row.isBootstrap &&
    row.bootstrapExpiresAt &&
    row.bootstrapExpiresAt <= nowSeconds()
  ) {
    await env.DB.prepare(
      'UPDATE auth_sessions SET revoked_at = ? WHERE session_handle_hash = ?',
    )
      .bind(nowSeconds(), row.sessionHandleHash)
      .run();
    return json({ error: 'Bootstrap session expired' }, { status: 401 });
  }

  await decryptSecret(row.refreshTokenEnc, env);
  const nextRefreshEnc = await encryptSecret(
    `cont:${randomBase64Url(24)}`,
    env,
  );

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
    amr: row.isBootstrap ? ['bootstrap_meta'] : ['session_refresh'],
    bootstrap: Boolean(row.isBootstrap),
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
    needs_credential_setup: Boolean(
      row.isBootstrap || !context.user.authReadyAt,
    ),
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

async function handleAuthMe(req: Request, env: Env) {
  const auth = await requireAccessAuth(req, env);
  if (!auth) {
    return json({ authenticated: false });
  }
  const user = await env.DB.prepare(
    'SELECT auth_ready_at as authReadyAt FROM users WHERE id = ? LIMIT 1',
  )
    .bind(auth.claims.sub)
    .first<{ authReadyAt: number | null }>();
  return json({
    authenticated: true,
    userId: auth.claims.sub,
    orgId: auth.claims.org_id,
    role: auth.claims.role,
    name: auth.claims.name,
    email: auth.claims.email,
    metaUserId: auth.claims.meta_user_id ?? null,
    bootstrap: Boolean(auth.claims.bootstrap),
    needsCredentialSetup: Boolean(auth.claims.bootstrap || !user?.authReadyAt),
  });
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
    bootstrap: Boolean(auth.claims.bootstrap),
    amr: auth.claims.amr ?? [],
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
    `SELECT session_handle_hash as sessionHandleHash,
            user_id as userId,
            revoked_at as revokedAt,
            is_bootstrap as isBootstrap
     FROM auth_sessions
     WHERE session_handle_hash = ?
     LIMIT 1`,
  )
    .bind(sessionHash)
    .first<{
      sessionHandleHash: string;
      userId: string;
      revokedAt: number | null;
      isBootstrap: number;
    }>();
  if (!session || session.revokedAt) {
    return json({ error: 'Session not found' }, { status: 401 });
  }
  if (session.isBootstrap) {
    return json({ error: 'credential_setup_required' }, { status: 403 });
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
    amr: ['org_switch'],
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

async function handlePasswordLogin(req: Request, env: Env) {
  const body = await readJson<{ email?: string; password?: string }>(req);
  const email = body?.email?.trim().toLowerCase() ?? '';
  const password = body?.password ?? '';
  if (!email || !password) {
    return json({ error: 'Invalid email or password' }, { status: 401 });
  }
  const user = await env.DB.prepare(
    'SELECT id, email, name, auth_ready_at as authReadyAt FROM users WHERE email = ? LIMIT 1',
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      name: string;
      authReadyAt: number | null;
    }>();
  if (!user) {
    return json({ error: 'Invalid email or password' }, { status: 401 });
  }
  const passwordRow = await env.DB.prepare(
    `SELECT password_hash as passwordHash, password_salt as passwordSalt, iterations
     FROM user_passwords
     WHERE user_id = ?
     LIMIT 1`,
  )
    .bind(user.id)
    .first<{
      passwordHash: string;
      passwordSalt: string;
      iterations: number;
    }>();
  if (!passwordRow) {
    return json({ error: 'Invalid email or password' }, { status: 401 });
  }
  const computed = await hashPassword(
    password,
    passwordRow.passwordSalt,
    passwordRow.iterations,
  );
  if (!constantTimeEqual(computed, passwordRow.passwordHash)) {
    return json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const now = nowSeconds();
  await env.DB.prepare(
    'UPDATE users SET auth_ready_at = COALESCE(auth_ready_at, ?), updated_at = ? WHERE id = ?',
  )
    .bind(now, now, user.id)
    .run();

  const context = await resolveUserOrgContext(env, user.id, null);
  if (!context) {
    await ensureUserHasOrg(env, user.id, user.name);
  }

  const orgContext = await resolveUserOrgContext(env, user.id, null);
  if (!orgContext) {
    return json({ error: 'No organization membership found' }, { status: 403 });
  }
  const continuationSecret = `cont:${randomBase64Url(24)}`;
  const sessionHandle = await issueSessionForUser(env, {
    userId: user.id,
    orgId: orgContext.orgId,
    continuationSecret,
  });
  const access = await mintAccessToken(env, {
    userId: user.id,
    orgId: orgContext.orgId,
    role: orgContext.role,
    email: user.email,
    name: user.name,
    metaUserId: orgContext.metaUserId,
    amr: ['pwd'],
  });
  return json({
    access_token: access.token,
    session_handle: sessionHandle,
    return_to: '/',
  });
}

async function handlePasswordSet(req: Request, env: Env) {
  const auth = await requireAccessAuth(req, env);
  if (!auth) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await readJson<{ password?: string }>(req);
  const password = body?.password ?? '';
  if (password.length < 10) {
    return json(
      { error: 'Password must be at least 10 characters' },
      { status: 400 },
    );
  }

  const now = nowSeconds();
  const iterations = getPasswordIterations(env);
  const salt = randomBase64Url(16);
  const passwordHash = await hashPassword(password, salt, iterations);
  await env.DB.prepare(
    `INSERT INTO user_passwords (
       user_id, password_hash, password_salt, algo, iterations, created_at, updated_at
     ) VALUES (?, ?, ?, 'pbkdf2-sha256', ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       algo = excluded.algo,
       iterations = excluded.iterations,
       updated_at = excluded.updated_at`,
  )
    .bind(auth.claims.sub, passwordHash, salt, iterations, now, now)
    .run();

  await env.DB.prepare(
    'UPDATE users SET auth_ready_at = COALESCE(auth_ready_at, ?), updated_at = ? WHERE id = ?',
  )
    .bind(now, now, auth.claims.sub)
    .run();

  await revokeBootstrapSessions(env, auth.claims.sub);
  const context = await resolveUserOrgContext(
    env,
    auth.claims.sub,
    auth.claims.org_id,
  );
  if (!context) {
    return json({ error: 'No organization membership found' }, { status: 403 });
  }
  const continuationSecret = `cont:${randomBase64Url(24)}`;
  const sessionHandle = await issueSessionForUser(env, {
    userId: context.user.id,
    orgId: context.orgId,
    continuationSecret,
  });
  const access = await mintAccessToken(env, {
    userId: context.user.id,
    orgId: context.orgId,
    role: context.role,
    email: context.user.email,
    name: context.user.name,
    metaUserId: context.metaUserId,
    amr: ['pwd_set'],
  });
  return json({
    ok: true,
    credential_ready: true,
    access_token: access.token,
    session_handle: sessionHandle,
  });
}

async function sendResetEmail(env: Env, to: string, rawToken: string) {
  if (!env.RESEND_API_KEY) return;
  const from = env.AUTH_EMAIL_FROM || env.ALERT_EMAIL_FROM;
  if (!from) return;
  const link = `${env.APP_ORIGIN ?? 'http://localhost:5173'}/reset-password#token=${encodeURIComponent(rawToken)}`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: env.AUTH_EMAIL_REPLY_TO || undefined,
      subject: 'Reset your msgstats password',
      text: `Use this link to reset your password: ${link}`,
    }),
  }).catch(() => null);
}

async function handlePasswordRecoverStart(req: Request, env: Env) {
  const body = await readJson<{ email?: string }>(req);
  const email = body?.email?.trim().toLowerCase() ?? '';
  if (email) {
    const user = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
    )
      .bind(email)
      .first<{ id: string }>();
    if (user) {
      const rawToken = randomBase64Url(32);
      const tokenHash = await sha256Hex(
        `${getPasswordResetPepper(env)}:${rawToken}`,
      );
      const now = nowSeconds();
      await env.DB.prepare(
        `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, used_at, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
      )
        .bind(tokenHash, user.id, now + 30 * 60, now)
        .run();
      await sendResetEmail(env, email, rawToken);
    }
  }
  return new Response(null, { status: 204 });
}

async function handlePasswordRecoverFinish(req: Request, env: Env) {
  const body = await readJson<{ token?: string; new_password?: string }>(req);
  const token = body?.token?.trim() ?? '';
  const password = body?.new_password ?? '';
  if (!token || password.length < 10) {
    return json({ error: 'Invalid token or password' }, { status: 400 });
  }
  const tokenHash = await sha256Hex(`${getPasswordResetPepper(env)}:${token}`);
  const row = await env.DB.prepare(
    `SELECT token_hash as tokenHash, user_id as userId, expires_at as expiresAt, used_at as usedAt
     FROM password_reset_tokens
     WHERE token_hash = ?
     LIMIT 1`,
  )
    .bind(tokenHash)
    .first<{
      tokenHash: string;
      userId: string;
      expiresAt: number;
      usedAt: number | null;
    }>();
  if (!row || row.usedAt || row.expiresAt <= nowSeconds()) {
    return json({ error: 'Token invalid or expired' }, { status: 400 });
  }

  const now = nowSeconds();
  const iterations = getPasswordIterations(env);
  const salt = randomBase64Url(16);
  const passwordHash = await hashPassword(password, salt, iterations);
  await env.DB.prepare(
    `INSERT INTO user_passwords (
       user_id, password_hash, password_salt, algo, iterations, created_at, updated_at
     ) VALUES (?, ?, ?, 'pbkdf2-sha256', ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       algo = excluded.algo,
       iterations = excluded.iterations,
       updated_at = excluded.updated_at`,
  )
    .bind(row.userId, passwordHash, salt, iterations, now, now)
    .run();
  await env.DB.prepare(
    'UPDATE users SET auth_ready_at = COALESCE(auth_ready_at, ?), updated_at = ? WHERE id = ?',
  )
    .bind(now, now, row.userId)
    .run();
  await env.DB.prepare(
    'UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?',
  )
    .bind(now, row.tokenHash)
    .run();
  await revokeBootstrapSessions(env, row.userId);

  return json({ ok: true });
}

async function handlePasskeyRegisterStart(req: Request, env: Env) {
  const auth = await requireAccessAuth(req, env);
  if (!auth) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const user = await env.DB.prepare(
    'SELECT id, email, name FROM users WHERE id = ? LIMIT 1',
  )
    .bind(auth.claims.sub)
    .first<{ id: string; email: string; name: string }>();
  if (!user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = randomBase64Url(24);
  const now = nowSeconds();
  const existingCreds = await env.DB.prepare(
    'SELECT credential_id as credentialId, transports FROM webauthn_credentials WHERE user_id = ?',
  )
    .bind(user.id)
    .all<{ credentialId: string; transports: string | null }>();
  const excludeCredentials = (existingCreds.results ?? []).map((cred) => {
    let transports: string[] | undefined;
    try {
      transports = cred.transports
        ? (JSON.parse(cred.transports) as string[])
        : undefined;
    } catch {
      transports = undefined;
    }
    return {
      id: cred.credentialId,
      ...(transports?.length
        ? {
            transports: transports as unknown as Array<
              'ble' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'
            >,
          }
        : {}),
    };
  });
  const options = await generateRegistrationOptions({
    rpID: env.AUTH_RP_ID,
    rpName: env.AUTH_RP_NAME,
    userID: encoder.encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    timeout: 60000,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    supportedAlgorithmIDs: [-7],
    excludeCredentials,
  });
  const challenge = options.challenge;
  if (!challenge) {
    return json(
      { error: 'Could not create passkey challenge' },
      { status: 500 },
    );
  }
  await env.DB.prepare(
    `INSERT INTO webauthn_challenges (token, purpose, user_id, challenge, rp_id, created_at, expires_at)
     VALUES (?, 'register', ?, ?, ?, ?, ?)`,
  )
    .bind(token, user.id, challenge, env.AUTH_RP_ID, now, now + 10 * 60)
    .run();
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?')
    .bind(now)
    .run();

  return json({
    challenge_token: token,
    options,
  });
}

function getAllowedWebauthnOrigins(env: Env, req: Request) {
  const configured = (env.AUTH_ORIGIN_ALLOWLIST ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length > 0) {
    return configured;
  }
  return [appOrigin(env, req)];
}

function buildExpectedChallengeMatcher(storedChallenge: string) {
  return (receivedChallenge: string) => {
    if (receivedChallenge === storedChallenge) return true;
    const storedAsBytesThenEncoded = base64UrlEncode(
      encoder.encode(storedChallenge),
    );
    return receivedChallenge === storedAsBytesThenEncoded;
  };
}

async function handlePasskeyRegisterFinish(req: Request, env: Env) {
  const auth = await requireAccessAuth(req, env);
  if (!auth) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await readJson<{
    challenge_token?: string;
    response?: unknown;
  }>(req);
  const challengeToken = body?.challenge_token?.trim();
  if (!challengeToken || !body?.response) {
    return json(
      { error: 'Missing challenge token or response' },
      { status: 400 },
    );
  }
  const challengeRow = await env.DB.prepare(
    `SELECT token, user_id as userId, challenge, rp_id as rpId, expires_at as expiresAt
     FROM webauthn_challenges
     WHERE token = ? AND purpose = 'register'
     LIMIT 1`,
  )
    .bind(challengeToken)
    .first<{
      token: string;
      userId: string | null;
      challenge: string;
      rpId: string;
      expiresAt: number;
    }>();
  if (!challengeRow || challengeRow.expiresAt <= nowSeconds()) {
    return json({ error: 'Challenge expired' }, { status: 400 });
  }
  if (!challengeRow.userId || challengeRow.userId !== auth.claims.sub) {
    return json({ error: 'Challenge user mismatch' }, { status: 400 });
  }

  const verification = await verifyRegistrationResponse({
    response: body.response as unknown as Parameters<
      typeof verifyRegistrationResponse
    >[0]['response'],
    expectedChallenge: buildExpectedChallengeMatcher(challengeRow.challenge),
    expectedOrigin: getAllowedWebauthnOrigins(env, req),
    expectedRPID: challengeRow.rpId,
    requireUserVerification: false,
  }).catch((error) => ({
    verified: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  if (
    !verification ||
    !verification.verified ||
    !('registrationInfo' in verification)
  ) {
    return json(
      {
        error:
          'error' in (verification as object)
            ? (verification as { error?: string }).error ??
              'Passkey registration failed'
            : 'Passkey registration failed',
      },
      { status: 400 },
    );
  }

  const info = verification.registrationInfo;
  if (!info) {
    return json({ error: 'Missing registration info' }, { status: 400 });
  }
  const now = nowSeconds();
  const credentialId = info.credential.id;
  const publicKey = base64UrlEncode(info.credential.publicKey);
  const signCount = info.credential.counter;
  const transports =
    info.credential.transports && info.credential.transports.length > 0
      ? JSON.stringify(info.credential.transports)
      : null;
  const aaguid = info.aaguid || null;

  await env.DB.prepare(
    `INSERT INTO webauthn_credentials (
       id, user_id, credential_id, public_key, sign_count, transports, aaguid, created_at, last_used_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(credential_id) DO UPDATE SET
       user_id = excluded.user_id,
       public_key = excluded.public_key,
       sign_count = excluded.sign_count,
       transports = excluded.transports,
       aaguid = excluded.aaguid`,
  )
    .bind(
      crypto.randomUUID(),
      auth.claims.sub,
      credentialId,
      publicKey,
      signCount,
      transports,
      aaguid,
      now,
      now,
    )
    .run();
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?')
    .bind(challengeToken)
    .run();
  await env.DB.prepare(
    'UPDATE users SET auth_ready_at = COALESCE(auth_ready_at, ?), updated_at = ? WHERE id = ?',
  )
    .bind(now, now, auth.claims.sub)
    .run();
  await revokeBootstrapSessions(env, auth.claims.sub);

  const context = await resolveUserOrgContext(
    env,
    auth.claims.sub,
    auth.claims.org_id,
  );
  if (!context) {
    return json({ error: 'No organization membership found' }, { status: 403 });
  }
  const sessionHandle = await issueSessionForUser(env, {
    userId: context.user.id,
    orgId: context.orgId,
    continuationSecret: `cont:${randomBase64Url(24)}`,
  });
  const access = await mintAccessToken(env, {
    userId: context.user.id,
    orgId: context.orgId,
    role: context.role,
    email: context.user.email,
    name: context.user.name,
    metaUserId: context.metaUserId,
    amr: ['passkey'],
  });

  return json({
    ok: true,
    credential_ready: true,
    access_token: access.token,
    session_handle: sessionHandle,
  });
}

async function handlePasskeyLoginStart(req: Request, env: Env) {
  const body = await readJson<{ email?: string }>(req);
  const email = body?.email?.trim().toLowerCase() ?? '';
  const token = randomBase64Url(24);
  const now = nowSeconds();
  let userId: string | null = null;
  let allowCredentials:
    | Array<{
        id: string;
        transports?: Array<
          'ble' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'
        >;
      }>
    | undefined;
  if (email) {
    const user = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
    )
      .bind(email)
      .first<{ id: string }>();
    userId = user?.id ?? null;
    if (userId) {
      const creds = await env.DB.prepare(
        'SELECT credential_id as credentialId, transports FROM webauthn_credentials WHERE user_id = ?',
      )
        .bind(userId)
        .all<{ credentialId: string; transports: string | null }>();
      allowCredentials = (creds.results ?? []).map((item) => {
        let transports: string[] | undefined;
        try {
          transports = item.transports
            ? (JSON.parse(item.transports) as string[])
            : undefined;
        } catch {
          transports = undefined;
        }
        return {
          id: item.credentialId,
          ...(transports?.length
            ? {
                transports: transports as unknown as Array<
                  'ble' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'
                >,
              }
            : {}),
        };
      });
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: env.AUTH_RP_ID,
    timeout: 60000,
    userVerification: 'preferred',
    ...(allowCredentials && allowCredentials.length > 0
      ? {
          allowCredentials: allowCredentials.map((credential) => ({
            id: credential.id,
            ...(credential.transports?.length
              ? { transports: credential.transports }
              : {}),
          })),
        }
      : {}),
  });
  const challenge = options.challenge;
  if (!challenge) {
    return json(
      { error: 'Could not create passkey challenge' },
      { status: 500 },
    );
  }
  await env.DB.prepare(
    `INSERT INTO webauthn_challenges (token, purpose, user_id, challenge, rp_id, created_at, expires_at)
     VALUES (?, 'login', ?, ?, ?, ?, ?)`,
  )
    .bind(token, userId, challenge, env.AUTH_RP_ID, now, now + 10 * 60)
    .run();
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?')
    .bind(now)
    .run();

  return json({
    challenge_token: token,
    options,
  });
}

async function handlePasskeyLoginFinish(req: Request, env: Env) {
  const body = await readJson<{
    challenge_token?: string;
    response?: { id?: string } & Record<string, unknown>;
  }>(req);
  const challengeToken = body?.challenge_token?.trim();
  const credentialId = body?.response?.id?.trim();
  if (!challengeToken || !body?.response || !credentialId) {
    return json(
      { error: 'Missing challenge token or response' },
      { status: 400 },
    );
  }
  const challengeRow = await env.DB.prepare(
    `SELECT token, user_id as userId, challenge, rp_id as rpId, expires_at as expiresAt
     FROM webauthn_challenges
     WHERE token = ? AND purpose = 'login'
     LIMIT 1`,
  )
    .bind(challengeToken)
    .first<{
      token: string;
      userId: string | null;
      challenge: string;
      rpId: string;
      expiresAt: number;
    }>();
  if (!challengeRow || challengeRow.expiresAt <= nowSeconds()) {
    return json({ error: 'Challenge expired' }, { status: 400 });
  }

  const credential = await env.DB.prepare(
    `SELECT user_id as userId,
            credential_id as credentialId,
            public_key as publicKey,
            sign_count as signCount,
            transports
     FROM webauthn_credentials
     WHERE credential_id = ?
     LIMIT 1`,
  )
    .bind(credentialId)
    .first<{
      userId: string;
      credentialId: string;
      publicKey: string;
      signCount: number;
      transports: string | null;
    }>();
  if (!credential) {
    return json({ error: 'Credential not found' }, { status: 401 });
  }
  if (challengeRow.userId && challengeRow.userId !== credential.userId) {
    return json(
      { error: 'Credential does not match challenge user' },
      { status: 401 },
    );
  }

  let transports: string[] | undefined;
  try {
    transports = credential.transports
      ? (JSON.parse(credential.transports) as string[])
      : undefined;
  } catch {
    transports = undefined;
  }

  const verification = await verifyAuthenticationResponse({
    response: body.response as unknown as Parameters<
      typeof verifyAuthenticationResponse
    >[0]['response'],
    expectedChallenge: buildExpectedChallengeMatcher(challengeRow.challenge),
    expectedOrigin: getAllowedWebauthnOrigins(env, req),
    expectedRPID: challengeRow.rpId,
    credential: {
      id: credential.credentialId,
      publicKey: base64UrlDecode(credential.publicKey),
      counter: credential.signCount,
      ...(transports?.length
        ? {
            transports: transports as unknown as Array<
              'ble' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'
            >,
          }
        : {}),
    },
    requireUserVerification: false,
  }).catch((error) => ({
    verified: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (
    !verification ||
    !verification.verified ||
    !('authenticationInfo' in verification)
  ) {
    return json(
      {
        error:
          'error' in (verification as object)
            ? (verification as { error?: string }).error ??
              'Passkey login failed'
            : 'Passkey login failed',
      },
      { status: 401 },
    );
  }

  const now = nowSeconds();
  const newCounter = verification.authenticationInfo.newCounter;
  await env.DB.prepare(
    `UPDATE webauthn_credentials
     SET sign_count = ?, last_used_at = ?
     WHERE credential_id = ?`,
  )
    .bind(newCounter, now, credential.credentialId)
    .run();
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE token = ?')
    .bind(challengeToken)
    .run();
  await env.DB.prepare(
    'UPDATE users SET auth_ready_at = COALESCE(auth_ready_at, ?), updated_at = ? WHERE id = ?',
  )
    .bind(now, now, credential.userId)
    .run();

  const context = await resolveUserOrgContext(env, credential.userId, null);
  if (!context) {
    return json({ error: 'No organization membership found' }, { status: 403 });
  }
  const sessionHandle = await issueSessionForUser(env, {
    userId: context.user.id,
    orgId: context.orgId,
    continuationSecret: `cont:${randomBase64Url(24)}`,
  });
  const access = await mintAccessToken(env, {
    userId: context.user.id,
    orgId: context.orgId,
    role: context.role,
    email: context.user.email,
    name: context.user.name,
    metaUserId: context.metaUserId,
    amr: ['passkey'],
  });
  return json({
    access_token: access.token,
    session_handle: sessionHandle,
    return_to: '/',
  });
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

  const scopedUserIds = Array.from(new Set([input.metaUserId, user.id]));
  const placeholders = scopedUserIds.map(() => '?').join(',');
  const tableStatements = [
    `UPDATE meta_pages SET org_id = ? WHERE user_id IN (${placeholders}) AND (org_id IS NULL OR org_id = "")`,
    `UPDATE ig_assets SET org_id = ? WHERE user_id IN (${placeholders}) AND (org_id IS NULL OR org_id = "")`,
    `UPDATE conversations SET org_id = ? WHERE user_id IN (${placeholders}) AND (org_id IS NULL OR org_id = "")`,
    `UPDATE messages SET org_id = ? WHERE user_id IN (${placeholders}) AND (org_id IS NULL OR org_id = "")`,
    `UPDATE sync_states SET org_id = ? WHERE user_id IN (${placeholders}) AND (org_id IS NULL OR org_id = "")`,
    `UPDATE sync_runs SET org_id = ? WHERE user_id IN (${placeholders}) AND (org_id IS NULL OR org_id = "")`,
    `UPDATE conversation_tags SET org_id = ? WHERE user_id IN (${placeholders}) AND (org_id IS NULL OR org_id = "")`,
    `UPDATE saved_responses SET org_id = ? WHERE user_id IN (${placeholders}) AND (org_id IS NULL OR org_id = "")`,
    `UPDATE conversation_state_events SET org_id = ? WHERE user_id IN (${placeholders}) AND (org_id IS NULL OR org_id = "")`,
    `UPDATE meta_custom_labels_cache SET org_id = ? WHERE user_id IN (${placeholders}) AND (org_id IS NULL OR org_id = "")`,
    `UPDATE followup_events SET org_id = ? WHERE user_id IN (${placeholders}) AND (org_id IS NULL OR org_id = "")`,
  ];
  for (const statement of tableStatements) {
    await env.DB.prepare(statement)
      .bind(membership.orgId, ...scopedUserIds)
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
          };
          returnTo = sanitizeReturnTo(payload.returnTo ?? '/');
          linkUserId = payload.linkUserId ?? null;
          linkOrgId = payload.linkOrgId ?? null;
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
    'SELECT id, email, name, auth_ready_at as authReadyAt FROM users WHERE id = ? LIMIT 1',
  )
    .bind(mapping.userId)
    .first<{
      id: string;
      email: string;
      name: string;
      authReadyAt: number | null;
    }>();

  if (linkUserId && linkOrgId) {
    return Response.redirect(`${appOrigin(env, req)}${returnTo}`, 302);
  }

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

  if (user.authReadyAt) {
    return Response.redirect(
      `${appOrigin(env, req)}/login?error=use_your_login`,
      302,
    );
  }

  return await finalizeLoginSession(env, req, {
    userId: mapping.userId,
    returnTo,
    amr: ['bootstrap_meta'],
    isBootstrap: true,
    bootstrapTtlSec: 30 * 60,
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

  const context = await resolveUserOrgContext(env, mapped.userId, mapped.orgId);
  if (!context) {
    return json({ error: 'No organization membership found' }, { status: 403 });
  }
  const sessionHandle = await issueSessionForUser(env, {
    userId: mapped.userId,
    orgId: mapped.orgId,
    continuationSecret: `cont:${randomBase64Url(24)}`,
    isBootstrap: true,
    bootstrapExpiresAt: nowSeconds() + 30 * 60,
  });
  const access = await mintAccessToken(env, {
    userId: mapped.userId,
    orgId: mapped.orgId,
    role: 'owner',
    email,
    name,
    metaUserId: pending.metaUserId,
    bootstrap: true,
    amr: ['bootstrap_meta'],
  });
  return json({
    access_token: access.token,
    session_handle: sessionHandle,
    return_to: '/login?credential_setup=1',
    needs_credential_setup: true,
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

  if (method === 'GET' && path === '/auth/oauth/start/google') {
    return await handleGoogleStart(req, env);
  }
  if (method === 'GET' && path === '/auth/oauth/callback/google') {
    return await handleGoogleCallback(req, env);
  }
  if (method === 'GET' && path === '/auth/oauth/start/apple') {
    return await handleAppleStart(req, env);
  }
  if (
    (method === 'POST' || method === 'GET') &&
    path === '/auth/oauth/callback/apple'
  ) {
    return await handleAppleCallback(req, env);
  }

  if (method === 'POST' && path === '/api/auth/password/login') {
    return await handlePasswordLogin(req, env);
  }
  if (method === 'POST' && path === '/api/auth/password/set') {
    return await handlePasswordSet(req, env);
  }
  if (method === 'POST' && path === '/api/auth/password/recover/start') {
    return await handlePasswordRecoverStart(req, env);
  }
  if (method === 'POST' && path === '/api/auth/password/recover/finish') {
    return await handlePasswordRecoverFinish(req, env);
  }

  if (method === 'POST' && path === '/api/auth/passkey/register/start') {
    return await handlePasskeyRegisterStart(req, env);
  }
  if (method === 'POST' && path === '/api/auth/passkey/register/finish') {
    return await handlePasskeyRegisterFinish(req, env);
  }
  if (method === 'POST' && path === '/api/auth/passkey/login/start') {
    return await handlePasskeyLoginStart(req, env);
  }
  if (method === 'POST' && path === '/api/auth/passkey/login/finish') {
    return await handlePasskeyLoginFinish(req, env);
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
