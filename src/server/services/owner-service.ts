import type { AppConfig } from '../config';
import { isUniqueViolation, type SqlClient } from '../db/sql';
import type { Logger } from '../logger';
import { Errors } from '../errors';
import { hashPin, validatePin, verifyPin } from '../security/pin';
import type { PublicUser, Settings } from '../../shared/types';
import { isSupportedCurrency, normalizeCurrency } from '../../shared/currencies';
import { isValidLocale, isValidTimezone } from '../../shared/locale';
import { seedCategories } from './defaults';
import { createSettingsDefaults } from './settings-service';

export interface OwnerRow {
  id: string;
  pin_hash: string;
  pin_salt: string;
  display_name: string | null;
  currency: string;
  locale: string;
  timezone: string;
  session_epoch: number;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export const OWNER_ID = 'owner';
const LOCK_AFTER_FAILURES = 5;
const LOCK_MINUTES = 5;

export function toPublicUser(row: OwnerRow): PublicUser {
  return {
    id: row.id,
    displayName: row.display_name,
    currency: row.currency,
    locale: row.locale,
    timezone: row.timezone,
    createdAt: row.created_at,
  };
}

export interface ProfilePatch {
  displayName?: string | null;
  currency?: string;
  locale?: string;
  timezone?: string;
}

export class OwnerService {
  constructor(
    private readonly config: AppConfig,
    private readonly client: SqlClient,
    private readonly logger: Logger,
  ) {}

  async get(): Promise<OwnerRow | undefined> {
    return (await this.client.prepare('SELECT * FROM owner WHERE id = ?').get(OWNER_ID)) as OwnerRow | undefined;
  }

  async isConfigured(): Promise<boolean> {
    return Boolean(await this.get());
  }

  async require(): Promise<OwnerRow> {
    const owner = await this.get();
    if (!owner) throw Errors.unauthorized('Set up a PIN to open this ledger.');
    return owner;
  }

  async setup(input: {
    pin: string;
    displayName?: string | null;
    currency?: string;
    locale?: string;
    timezone?: string;
  }): Promise<{ owner: OwnerRow; settings: Settings }> {
    const pinError = validatePin(input.pin);
    if (pinError) throw Errors.badRequest(pinError);
    if (await this.get()) throw Errors.conflict('This ledger already has a PIN.');

    const currency = input.currency ? normalizeCurrency(input.currency) : 'USD';
    if (input.currency !== undefined && !isSupportedCurrency(input.currency)) {
      throw Errors.badRequest('Choose a supported currency.');
    }
    const locale = input.locale?.trim().slice(0, 20) ?? 'en-US';
    if (!isValidLocale(locale)) throw Errors.badRequest('Choose a valid locale.');
    const timezone = input.timezone?.trim().slice(0, 64) ?? 'UTC';
    if (!isValidTimezone(timezone)) throw Errors.badRequest('Choose a valid timezone.');

    const { hash, salt } = await hashPin(input.pin);
    const now = new Date().toISOString();
    try {
      await this.client.transaction(async () => {
      await this.client
        .prepare(
          `INSERT INTO owner
            (id, pin_hash, pin_salt, display_name, currency, locale, timezone, session_epoch, failed_attempts, locked_until, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)`,
        )
        .run(
          OWNER_ID,
          hash,
          salt,
          input.displayName?.trim().slice(0, 80) || null,
          currency,
          locale,
          timezone,
          now,
          now,
        );
      await createSettingsDefaults(this.client, now);
      await seedCategories(this.client, now);
      });
    } catch (error) {
      // Two simultaneous setup requests: the loser hits the owner primary key.
      if (isUniqueViolation(error)) throw Errors.conflict('This ledger already has a PIN.');
      throw error;
    }

    this.logger.info('Ledger created');
    const owner = (await this.get())!;
    const settingsRow = await this.client.prepare('SELECT * FROM settings WHERE id = ?').get(OWNER_ID);
    const settings: Settings = {
      theme: (settingsRow as { theme: Settings['theme'] } | undefined)?.theme ?? 'dark',
      density: (settingsRow as { density: Settings['density'] } | undefined)?.density ?? 'comfortable',
      navCollapsed: Boolean((settingsRow as { nav_collapsed?: number } | undefined)?.nav_collapsed),
      chartView: (settingsRow as { chart_view: Settings['chartView'] } | undefined)?.chart_view ?? 'bar',
      chartRange: (settingsRow as { chart_range: string } | undefined)?.chart_range ?? '6M',
      onboardingCompleted: Boolean((settingsRow as { onboarding_completed?: number } | undefined)?.onboarding_completed),
    };
    return { owner, settings };
  }

  async verify(pin: string): Promise<{ ok: true; owner: OwnerRow } | { ok: false; reason: 'invalid' | 'locked'; retryAfterSec?: number }> {
    const owner = await this.get();
    if (!owner) throw Errors.unauthorized('Set up a PIN to open this ledger.');

    const now = new Date();
    if (owner.locked_until && new Date(owner.locked_until).getTime() > now.getTime()) {
      const retryAfterSec = Math.ceil((new Date(owner.locked_until).getTime() - now.getTime()) / 1000);
      return { ok: false, reason: 'locked', retryAfterSec };
    }

    const valid = validatePin(pin) === null && (await verifyPin(pin, owner.pin_hash, owner.pin_salt));
    if (!valid) {
      // Increment atomically in SQL so parallel wrong guesses cannot all read
      // the same counter and slip past the lockout.
      const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
      const updated = await this.client
        .prepare(
          `UPDATE owner SET
             failed_attempts = CASE WHEN failed_attempts + 1 >= ? THEN 0 ELSE failed_attempts + 1 END,
             locked_until = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE NULL END,
             updated_at = ?
           WHERE id = ?
           RETURNING locked_until`,
        )
        .get<{ locked_until: string | null }>(
          LOCK_AFTER_FAILURES,
          LOCK_AFTER_FAILURES,
          lockedUntil,
          now.toISOString(),
          OWNER_ID,
        );
      const locked = Boolean(updated?.locked_until);
      this.logger.warn({ locked }, 'PIN verification failed');
      return { ok: false, reason: locked ? 'locked' : 'invalid', ...(locked ? { retryAfterSec: LOCK_MINUTES * 60 } : {}) };
    }

    await this.client
      .prepare('UPDATE owner SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
      .run(now.toISOString(), OWNER_ID);
    return { ok: true, owner: { ...owner, failed_attempts: 0, locked_until: null } };
  }

  async changePin(currentPin: string, newPin: string): Promise<OwnerRow> {
    const owner = await this.require();
    if (!(await verifyPin(currentPin, owner.pin_hash, owner.pin_salt))) {
      throw Errors.unauthorized('The current PIN did not match.');
    }
    const pinError = validatePin(newPin);
    if (pinError) throw Errors.badRequest(pinError);
    if (currentPin === newPin) throw Errors.badRequest('Choose a different PIN.');

    const { hash, salt } = await hashPin(newPin);
    const now = new Date().toISOString();
    await this.client
      .prepare(
        `UPDATE owner SET pin_hash = ?, pin_salt = ?, session_epoch = session_epoch + 1,
           failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(hash, salt, now, OWNER_ID);
    return (await this.get())!;
  }

  async updateProfile(patch: ProfilePatch): Promise<OwnerRow> {
    const owner = await this.require();

    let currency = owner.currency;
    if (patch.currency !== undefined) {
      if (!isSupportedCurrency(patch.currency)) throw Errors.badRequest('Choose a supported currency.');
      const nextCurrency = normalizeCurrency(patch.currency);
      if (nextCurrency !== owner.currency) {
        const accounts = (await this.client.prepare('SELECT COUNT(*) AS n FROM accounts').get()) as { n: number };
        if (accounts.n > 0) throw Errors.badRequest('Delete your accounts before changing the ledger currency.');
        currency = nextCurrency;
      }
    }
    if (patch.locale !== undefined && !isValidLocale(patch.locale)) throw Errors.badRequest('Choose a valid locale.');
    if (patch.timezone !== undefined && !isValidTimezone(patch.timezone)) throw Errors.badRequest('Choose a valid timezone.');

    await this.client
      .prepare(
        `UPDATE owner SET display_name = ?, currency = ?, locale = ?, timezone = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.displayName !== undefined ? patch.displayName?.trim().slice(0, 80) || null : owner.display_name,
        currency,
        patch.locale?.trim().slice(0, 20) ?? owner.locale,
        patch.timezone?.trim().slice(0, 64) ?? owner.timezone,
        new Date().toISOString(),
        OWNER_ID,
      );
    return (await this.get())!;
  }
}
