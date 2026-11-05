import { useState, type FormEvent } from 'react';
import { ArrowRight, Contrast, KeyRound, Moon, ShieldCheck, Sun } from 'lucide-react';
import { api, ApiError, type MeResponse } from '../lib/api';
import { useSession } from '../lib/session';
import { TallyMark, Wordmark } from '../components/TallyMark';
import { Field, Spinner } from '../components/ui';
import type { ThemeName } from '../../shared/types';
import { otherCurrencies, primaryCurrencies } from '../../shared/currencies';

function authMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'TALLY could not reach the server. Check your connection and try again.';
}

export function AuthPage() {
  const { adopt, configured, theme, previewTheme } = useSession();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isSetup = !configured;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (isSetup && pin !== confirmPin) {
      setError('The two PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      const result: MeResponse = isSetup
        ? await api.setup({
            pin,
            displayName: displayName.trim() || undefined,
            currency,
            locale: navigator.language || 'en-US',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          })
        : await api.login(pin);
      adopt(result);
    } catch (caught) {
      setError(authMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-story">
        <div className="auth-brand">
          <TallyMark size={25} title="TALLY" />
          <Wordmark />
          <span className="auth-brand-sub">PRIVATE LEDGER</span>
        </div>
        <div className="auth-copy">
          <p className="auth-kicker">PERSONAL FINANCE, KEPT PERSONAL</p>
          <h1 className="auth-headline">Every dollar, accounted for.</h1>
          <p className="auth-lede">
            A quiet place to see what comes in, what goes out, and what it all means. One PIN, one ledger, no accounts to
            manage.
          </p>
          <div className="auth-proof">
            <div>
              <strong>One PIN, nothing else</strong>
              <span>No usernames, passwords, recovery codes, or authenticator apps.</span>
            </div>
            <div>
              <strong>No data brokers</strong>
              <span>One app, one database, no third-party analytics or trackers.</span>
            </div>
            <div>
              <strong>Yours to leave</strong>
              <span>Export your cash flow and transactions as CSV whenever you want.</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--auth-panel-muted)', fontSize: 11 }}>
          <KeyRound size={13} /> Single owner · scrypt PIN · five attempts, then a short lock
        </div>
      </section>

      <section className="auth-form-side">
        <div className="auth-topline">
          <span className="hint">{isSetup ? 'Set up TALLY' : 'Welcome back'}</span>
          <ThemeSwitcher theme={theme} onChange={previewTheme} />
        </div>
        <div className="auth-form-wrap">
          <h2 className="auth-title">{isSetup ? 'Choose a PIN' : 'Enter your PIN'}</h2>
          <p className="auth-sub">
            {isSetup
              ? 'This PIN is the only key to your ledger. Pick something you will remember; it cannot be reset from here.'
              : 'Unlock your ledger to pick up exactly where it left off.'}
          </p>

          <form className="auth-form" onSubmit={submit}>
            {isSetup ? (
              <>
                <Field label="Display name" htmlFor="auth-display-name" hint="Optional. Shown only inside your own ledger.">
                  <input
                    id="auth-display-name"
                    className="input"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    autoComplete="name"
                    maxLength={80}
                    placeholder="Avery Chen"
                  />
                </Field>
                <Field label="Currency" htmlFor="auth-currency">
                  <div className="select-wrap">
                    <select
                      id="auth-currency"
                      className="select"
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                    >
                      <optgroup label="Primary currencies">
                        {primaryCurrencies().map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.code} - {option.name} ({option.symbol})
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Other currencies">
                        {otherCurrencies().map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.code} - {option.name} ({option.symbol})
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                </Field>
              </>
            ) : null}

            <Field
              label="PIN"
              htmlFor="auth-pin"
              hint={isSetup ? '4–12 digits. Avoid obvious sequences and repeated digits.' : undefined}
            >
              <input
                id="auth-pin"
                className="input"
                type="password"
                inputMode="numeric"
                pattern="\d{4,12}"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
                autoComplete={isSetup ? 'new-password' : 'current-password'}
                autoFocus
                required
                minLength={4}
                maxLength={12}
                style={{ letterSpacing: '0.3em' }}
              />
            </Field>

            {isSetup ? (
              <Field label="Confirm PIN" htmlFor="auth-pin-confirm">
                <input
                  id="auth-pin-confirm"
                  className="input"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4,12}"
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
                  autoComplete="new-password"
                  required
                  minLength={4}
                  maxLength={12}
                  style={{ letterSpacing: '0.3em' }}
                />
              </Field>
            ) : null}

            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}

            <button className="btn btn-primary btn-wide auth-submit" type="submit" disabled={busy}>
              {busy ? <Spinner label={isSetup ? 'Creating your ledger' : 'Unlocking'} /> : null}
              {isSetup ? 'Create my ledger' : 'Unlock'}
              {!busy ? <ArrowRight size={15} /> : null}
            </button>
          </form>

          <div className="auth-security-note">
            <ShieldCheck size={14} style={{ flex: 'none', marginTop: 1 }} />
            <span>
              Your PIN is hashed with scrypt and the session cookie is signed HTTP-only. Five wrong attempts lock entry
              for five minutes.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function ThemeSwitcher({ theme, onChange }: { theme: ThemeName; onChange: (theme: ThemeName) => void }) {
  return (
    <div className="auth-theme" role="group" aria-label="Color theme">
      <button
        type="button"
        data-active={theme === 'light'}
        onClick={() => onChange('light')}
        aria-label="Light theme"
        aria-pressed={theme === 'light'}
      >
        <Sun size={14} />
      </button>
      <button
        type="button"
        data-active={theme === 'dark'}
        onClick={() => onChange('dark')}
        aria-label="Dark theme"
        aria-pressed={theme === 'dark'}
      >
        <Moon size={14} />
      </button>
      <button
        type="button"
        data-active={theme === 'contrast'}
        onClick={() => onChange('contrast')}
        aria-label="High contrast theme"
        aria-pressed={theme === 'contrast'}
      >
        <Contrast size={14} />
      </button>
    </div>
  );
}
