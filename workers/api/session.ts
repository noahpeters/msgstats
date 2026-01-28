const encoder = new TextEncoder();

type SessionPayload = {
  userId: string;
  expiresAt: number;
};

const COOKIE_NAME = 'msgstats_session';

function base64UrlEncode(input: ArrayBuffer | Uint8Array) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let str = '';
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const normalized = padded + '='.repeat(padLength);
  const decoded = atob(normalized);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

async function sign(payload: string, secret: string) {
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
    encoder.encode(payload),
  );
  return base64UrlEncode(signature);
}

async function verify(payload: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlDecode(signature),
    encoder.encode(payload),
  );
}

export async function createSessionToken(
  payload: SessionPayload,
  secret: string,
) {
  const encodedPayload = base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  );
  const signature = await sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function readSessionToken(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }
  const valid = await verify(encodedPayload, signature, secret);
  if (!valid) {
    return null;
  }
  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(encodedPayload)),
  ) as SessionPayload;
  if (!payload?.userId || !payload.expiresAt) {
    return null;
  }
  if (payload.expiresAt < Date.now()) {
    return null;
  }
  return payload;
}

export function getSessionCookie(headers: Headers) {
  const cookie = headers.get('cookie') ?? '';
  const parts = cookie.split(';').map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!match) {
    return null;
  }
  return match.slice(COOKIE_NAME.length + 1);
}

export function buildSessionCookie(
  token: string,
  maxAgeSeconds: number,
  options?: { secure?: boolean },
) {
  const secure = options?.secure ?? true;
  const securePart = secure ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly${securePart}; SameSite=Lax; Max-Age=${Math.floor(
    maxAgeSeconds,
  )}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
