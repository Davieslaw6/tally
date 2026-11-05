import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  epoch: number;
  expires: number;
}

function signature(secret: string, expires: number, epoch: number): string {
  return createHmac('sha256', secret).update(`v1.${expires}.${epoch}`).digest('base64url');
}

export function createSessionToken(secret: string, epoch: number, days: number, now = Date.now()): string {
  const expires = now + days * 86_400_000;
  return `v1.${expires}.${epoch}.${signature(secret, expires, epoch)}`;
}

export function verifySessionToken(secret: string, token: string, now = Date.now()): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const expires = Number(parts[1]);
  const epoch = Number(parts[2]);
  if (!Number.isSafeInteger(expires) || !Number.isSafeInteger(epoch) || expires <= now) return null;

  const expected = Buffer.from(signature(secret, expires, epoch));
  const provided = Buffer.from(parts[3] ?? '');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return { epoch, expires };
}
