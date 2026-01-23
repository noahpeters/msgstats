import crypto from 'crypto';

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptString(plain: string, secret: string): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const key = deriveKey(secret);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptString(
  payload: EncryptedPayload,
  secret: string,
): string {
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
