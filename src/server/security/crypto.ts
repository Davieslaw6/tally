import { randomBytes } from 'node:crypto';

/** URL-safe opaque token used for record IDs. */
export function randomToken(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}
