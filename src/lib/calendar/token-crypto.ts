import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function encryptionKey(encoded = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY): Buffer {
  if (!encoded) throw new Error('Calendar token encryption is not configured.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('Calendar token encryption is not configured.');
  return key;
}

export function encryptRefreshToken(token: string, encodedKey?: string): string {
  if (!token) throw new Error('Refresh token is missing.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptRefreshToken(value: string, encodedKey?: string): string {
  try {
    const [version, ivValue, tagValue, ciphertextValue, extra] = value.split('.');
    if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue || extra) throw new Error('invalid');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(encodedKey), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored calendar authorization is invalid.');
  }
}
