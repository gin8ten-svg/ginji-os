import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export class CalendarStoredTokenError extends Error {}

function encryptionKey(encoded = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY): Buffer {
  if (!encoded) throw new Error('Calendar token encryption is not configured.');
  if (!/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(encoded)) throw new Error('Calendar token encryption is not configured.');
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
    const base64url = /^[A-Za-z0-9_-]+$/;
    if (!base64url.test(ivValue) || !base64url.test(tagValue) || !base64url.test(ciphertextValue)) throw new Error('invalid');
    const iv = Buffer.from(ivValue, 'base64url');
    const tag = Buffer.from(tagValue, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(encodedKey), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new CalendarStoredTokenError('Stored calendar authorization is invalid.');
  }
}
