import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 32;
const SCRYPT_OPTIONS: ScryptOptions = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export interface PinHash {
  hash: string;
  salt: string;
}

export function validatePin(pin: unknown): string | null {
  if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) {
    return 'Use a PIN of 4 to 12 digits.';
  }
  return null;
}

export async function hashPin(pin: string): Promise<PinHash> {
  const salt = randomBytes(16);
  const derived = await scrypt(pin, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return { hash: derived.toString('base64'), salt: salt.toString('base64') };
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  try {
    const expected = Buffer.from(hash, 'base64');
    const derived = await scrypt(pin, Buffer.from(salt, 'base64'), expected.length, SCRYPT_OPTIONS);
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}
