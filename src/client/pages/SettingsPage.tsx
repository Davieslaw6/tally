import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Check,
  Database,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Info,
  KeyRound,
  Palette,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import type { PublicUser, Settings, ThemeName } from '../../shared/types';
import { currencyLabel, isSupportedCurrency, otherCurrencies, primaryCurrencies } from '../../shared/currencies';
import { api, ApiError } from '../lib/api';
import { rangeForPreset } from '../lib/finance';
import { useFormatDate, useSession } from '../lib/session';
import { useToast } from '../components/Toast';
import { TallyMark, Wordmark } from '../components/TallyMark';
import { Field, PageHead, Spinner, StatusPill } from '../components/ui';

type Tab = 'profile' | 'appearance' | 'security' | 'data' | 'about';

const TABS: Array<{ id: Tab; label: string; icon: typeof UserRound }> = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'about', label: 'About', icon: Info },
];

const LOCALES = [
  'en-NG', 'en-US', 'en-GB', 'en-CA', 'fr-CA', 'en-AU', 'en-NZ', 'de-DE', 'fr-FR', 'es-ES', 'it-IT',
  'nl-NL', 'pt-BR', 'sv-SE', 'da-DK', 'nb-NO', 'ja-JP', 'zh-CN', 'ko-KR',
];

const THEME_CHOICES: Array<{ value: ThemeName; label: string; note: string; ground: string; ink: string; accent: string }> = [
  {
    value: 'light',
    label: 'Paper',
    note: 'Warm daylight',
    ground: 'oklch(0.963 0.01 95)',
    ink: 'oklch(0.195 0.018 135)',
    accent: 'oklch(0.52 0.095 155)',
  },
  {
    value: 'dark',
    label: 'Evening',
    note: 'Low-light ledger',
    ground: 'oklch(0.155 0.012 135)',
    ink: 'oklch(0.965 0.008 95)',
    accent: 'oklch(0.77 0.12 155)',
  },
  {
    value: 'contrast',
    label: 'High contrast',
    note: 'Maximum legibility',
    ground: 'oklch(0 0 0)',
    ink: 'oklch(1 0 0)',
    accent: 'oklch(0.87 0.22 155)',
  },
];

const CHART_RANGES = [
  { value: '1M', label: 'One month' },
  { value: '3M', label: 'Three months' },
  { value: '6M', label: 'Six months' },
  { value: '1Y', label: 'One year' },
  { value: 'YTD', label: 'Year to date' },
];

function parseTab(value: string | null): Tab {
  return value === 'appearance' || value === 'security' || value === 'data' || value === 'about' ? value : 'profile';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function fieldError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const details = error.details as { fields?: Array<{ path?: string; message?: string }> } | undefined;
    const first = details?.fields?.[0];
    if (first?.message) return first.message;
    return error.message;
  }
  return fallback;
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useSession();
  const tab = parseTab(searchParams.get('tab'));

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'profile') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  if (!user) return null;

  return (
    <div className="page">
      <PageHead
        title="Settings"
        sub={
          <>
            Single-owner ledger · appearance, access, and a copy of your data.
          </>
        }
        actions={<StatusPill tone="accent">PIN protected</StatusPill>}
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                data-active={tab === item.id}
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => setTab(item.id)}
              >
                <Icon size={15} aria-hidden="true" style={{ marginRight: 8 }} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="settings-view" role="region" aria-label={`${TABS.find((item) => item.id === tab)?.label ?? 'Settings'} settings`}>
          {tab === 'profile' ? <ProfilePanel user={user} /> : null}
          {tab === 'appearance' ? <AppearancePanel /> : null}
          {tab === 'security' ? <SecurityPanel /> : null}
          {tab === 'data' ? <DataPanel user={user} /> : null}
          {tab === 'about' ? <AboutPanel user={user} /> : null}
        </div>
      </div>
    </div>
  );
}

function ProfilePanel({ user }: { user: PublicUser }) {
  const { updateUser } = useSession();
  const toast = useToast();
  const formatDate = useFormatDate();
  const accounts = useQuery({ queryKey: ['accounts', true], queryFn: () => api.accounts(true) });
  const hasAccounts = (accounts.data?.accounts.length ?? 0) > 0;

  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [currency, setCurrency] = useState(user.currency);
  const [locale, setLocale] = useState(user.locale || 'en-US');
  const [timezone, setTimezone] = useState(user.timezone || 'UTC');
  const [error, setError] = useState('');

  const timezones = useMemo(() => {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    const values = new Set<string>([user.timezone || 'UTC', 'UTC', ...supported]);
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [user.timezone]);

  const locales = useMemo(() => {
    const values = new Set<string>([user.locale || 'en-US', ...LOCALES]);
    return [...values];
  }, [user.locale]);

  const save = useMutation({
    mutationFn: () =>
      api.updateProfile({
        displayName: displayName.trim() || null,
        currency,
        locale,
        timezone,
      }),
    onSuccess: (result) => {
      updateUser(result.user, result.settings);
      setError('');
      toast.success('Profile saved.');
    },
    onError: (caught) => setError(fieldError(caught, 'Your profile could not be saved.')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!isSupportedCurrency(currency)) return setError('Choose a supported currency.');
    if (!timezone.trim()) return setError('Choose a timezone.');
    save.mutate();
  };

  const name = displayName.trim() || user.displayName || 'My ledger';

  return (
    <>
      <h2>Profile</h2>
      <p>How TALLY addresses you, formats money, and places transactions in time. These details never leave your server.</p>

      <section className="settings-section">
        <div className="profile-banner">
          <span className="profile-avatar" aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{name}</strong>
            <span>Opened {formatDate(user.createdAt, 'long')}</span>
          </div>
          <StatusPill tone="neutral">Owner</StatusPill>
        </div>
      </section>

      <section className="settings-section">
        <h3>Identity</h3>
        <p>A display name is only shown inside this workspace. Your PIN is the only way in.</p>
        <form className="settings-form" onSubmit={submit}>
          <Field label="Display name" htmlFor="settings-display-name" hint="Optional. Up to 80 characters.">
            <input
              id="settings-display-name"
              className="input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
              autoComplete="name"
              placeholder="Avery Chen"
            />
          </Field>

          <div className="form-grid">
            <Field
              label="Currency"
              htmlFor="settings-currency"
              hint={hasAccounts ? 'Archive every account before changing the workspace currency.' : 'Used for every amount in the ledger.'}
            >
              <div className="select-wrap">
                <select
                  id="settings-currency"
                  className="select"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  disabled={hasAccounts || accounts.isLoading}
                >
                  {primaryCurrencies().map((option) => (
                    <option key={option.code} value={option.code}>{option.code} - {option.name} ({option.symbol})</option>
                  ))}
                  {otherCurrencies().map((option) => (
                    <option key={option.code} value={option.code}>{option.code} - {option.name} ({option.symbol})</option>
                  ))}
                  {!isSupportedCurrency(currency) ? <option value={currency}>{currencyLabel(currency)}</option> : null}
                </select>
              </div>
            </Field>
            <Field label="Locale" htmlFor="settings-locale" hint="Controls date and number formatting.">
              <div className="select-wrap">
                <select id="settings-locale" className="select" value={locale} onChange={(event) => setLocale(event.target.value)}>
                  {locales.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
            </Field>
          </div>

          <Field label="Timezone" htmlFor="settings-timezone" hint="Today, months, and reports are calculated here.">
            <div className="select-wrap">
              <select id="settings-timezone" className="select" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                {timezones.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            </div>
          </Field>

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="settings-actions">
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? <Spinner label="Saving profile" /> : <Check size={14} />}
              Save profile
            </button>
            <span className="hint">Changes apply immediately across the app.</span>
          </div>
        </form>
      </section>
    </>
  );
}

function AppearancePanel() {
  const { settings, theme, density, updateSettings } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (!settings) return null;

  const apply = async (key: string, patch: Partial<Settings>) => {
    setBusy(key);
    try {
      await updateSettings(patch);
      toast.success('Appearance saved.');
    } catch (error) {
      toast.error(errorMessage(error, 'The appearance preference could not be saved.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h2>Appearance</h2>
      <p>A quiet surface for reading your money. TALLY remembers these choices in your ledger.</p>

      <section className="settings-section">
        <h3>Theme</h3>
        <p>Every theme uses the same contrast-tested tokens. The high-contrast theme doubles as a strong accessibility mode.</p>
        <div className="theme-options" role="group" aria-label="Color theme">
          {THEME_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className="theme-choice"
              data-active={theme === choice.value}
              aria-pressed={theme === choice.value}
              disabled={busy !== null}
              onClick={() => void apply(`theme-${choice.value}`, { theme: choice.value })}
              style={
                {
                  '--theme-ground': choice.ground,
                  '--theme-ink': choice.ink,
                  '--theme-accent': choice.accent,
                } as CSSProperties
              }
            >
              <span className="theme-swatch" aria-hidden="true"><i /><i /><i /></span>
              <span>
                <strong>{choice.label}</strong>
                <small>{choice.note}</small>
              </span>
              {theme === choice.value ? <Check size={13} className="theme-check" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 9 }}>
          A local copy prevents a flash of the wrong palette while the app boots.
        </p>
      </section>

      <section className="settings-section">
        <h3>Density</h3>
        <p>Compact mode tightens rows and controls for larger screens and longer ledgers.</p>
        <div className="segmented" role="group" aria-label="Interface density">
          {(['comfortable', 'compact'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={density === value}
              disabled={busy !== null}
              onClick={() => void apply(`density-${value}`, { density: value })}
            >
              {value === 'comfortable' ? 'Comfortable' : 'Compact'}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3>Cash-flow defaults</h3>
        <p>The starting range and style for a fresh view. The dashboard remembers your last choice while you navigate.</p>
        <div className="settings-form">
          <Field label="Chart style" hint="Bars compare periods most clearly; area shows the shape of the flow.">
            <div className="segmented" role="group" aria-label="Default chart style">
              {(['bar', 'area', 'line'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={settings.chartView === value}
                  disabled={busy !== null}
                  onClick={() => void apply(`view-${value}`, { chartView: value })}
                >
                  {value === 'bar' ? 'Bars' : value === 'area' ? 'Area' : 'Line'}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Default range" htmlFor="settings-chart-range">
            <div className="select-wrap">
              <select
                id="settings-chart-range"
                className="select"
                value={settings.chartRange}
                disabled={busy !== null}
                onChange={(event) => void apply('range', { chartRange: event.target.value })}
              >
                {CHART_RANGES.map((range) => (
                  <option key={range.value} value={range.value}>{range.label}</option>
                ))}
                {settings.chartRange === 'custom' ? <option value="custom">Custom (last used)</option> : null}
              </select>
            </div>
          </Field>
        </div>
      </section>
    </>
  );
}

function SecurityPanel() {
  const toast = useToast();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');

  const change = useMutation({
    mutationFn: () => api.changePin(currentPin, newPin),
    onSuccess: () => {
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      toast.success('PIN changed. Other browsers will need the new PIN.');
    },
    onError: (caught) => setError(fieldError(caught, 'The PIN could not be changed.')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!/^\d{4,12}$/.test(newPin)) return setError('Use a PIN of 4 to 12 digits.');
    if (newPin !== confirmPin) return setError('The new PINs do not match.');
    change.mutate();
  };

  return (
    <>
      <h2>Security</h2>
      <p>One PIN, hashed with scrypt. Five wrong attempts lock entry for five minutes. Changing the PIN signs out every other browser.</p>

      <section className="settings-section">
        <h3>Change PIN</h3>
        <form className="settings-form" onSubmit={submit}>
          <Field label="Current PIN" htmlFor="settings-current-pin">
            <div style={{ position: 'relative' }}>
              <input
                id="settings-current-pin"
                className="input"
                style={{ paddingRight: 38, letterSpacing: '0.25em' }}
                type={show ? 'text' : 'password'}
                inputMode="numeric"
                value={currentPin}
                onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="icon-btn"
                style={{ position: 'absolute', right: 2, top: 2 }}
                onClick={() => setShow((value) => !value)}
                aria-label={show ? 'Hide PIN' : 'Show PIN'}
              >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>
          <div className="form-grid">
            <Field label="New PIN" htmlFor="settings-new-pin" hint="4–12 digits. Avoid sequences and repeated digits.">
              <input
                id="settings-new-pin"
                className="input"
                style={{ letterSpacing: '0.25em' }}
                type={show ? 'text' : 'password'}
                inputMode="numeric"
                value={newPin}
                onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
                autoComplete="new-password"
                required
                minLength={4}
                maxLength={12}
              />
            </Field>
            <Field label="Confirm new PIN" htmlFor="settings-confirm-pin">
              <input
                id="settings-confirm-pin"
                className="input"
                style={{ letterSpacing: '0.25em' }}
                type={show ? 'text' : 'password'}
                inputMode="numeric"
                value={confirmPin}
                onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
                autoComplete="new-password"
                required
                minLength={4}
                maxLength={12}
              />
            </Field>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="settings-actions">
            <button type="submit" className="btn" disabled={change.isPending}>
              {change.isPending ? <Spinner label="Changing PIN" /> : <KeyRound size={14} />}
              Change PIN
            </button>
            <span className="hint">This browser stays signed in with a fresh session.</span>
          </div>
        </form>
      </section>

      <section className="settings-section">
        <h3>How access works</h3>
        <div className="simple-list">
          <div className="settings-inline">
            <div className="settings-inline-main">
              <div className="settings-inline-title"><ShieldCheck size={14} /> PIN hashing</div>
              <div className="settings-inline-sub">scrypt with a per-install salt. The PIN is never stored in plaintext.</div>
            </div>
            <StatusPill>Enforced</StatusPill>
          </div>
          <div className="settings-inline">
            <div className="settings-inline-main">
              <div className="settings-inline-title"><KeyRound size={14} /> Sessions</div>
              <div className="settings-inline-sub">HTTP-only, SameSite=Lax cookies signed with the server secret.</div>
            </div>
            <StatusPill>Signed</StatusPill>
          </div>
        </div>
      </section>
    </>
  );
}

function DataPanel({ user }: { user: PublicUser }) {
  const toast = useToast();
  const timezone = user.timezone || 'UTC';
  const [busy, setBusy] = useState<'cashflow' | 'transactions' | null>(null);
  const range = useMemo(() => rangeForPreset('1Y', timezone), [timezone]);

  const run = async (which: 'cashflow' | 'transactions') => {
    setBusy(which);
    try {
      if (which === 'cashflow') {
        await api.downloadCashFlowCsv({ from: range.from, to: range.to });
        toast.success('Cash-flow CSV downloaded.');
      } else {
        await api.downloadTransactionsCsv({ from: range.from, to: range.to });
        toast.success('Transaction CSV downloaded.');
      }
    } catch (error) {
      toast.error(errorMessage(error, 'The export could not be prepared.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h2>Data</h2>
      <p>Download a portable copy of your ledger. Both files cover the last twelve months and open in any spreadsheet.</p>

      <section className="settings-section">
        <h3>CSV exports</h3>
        <div className="export-list">
          <button type="button" className="export-row" onClick={() => void run('cashflow')} disabled={busy !== null}>
            <span>
              <strong>Cash-flow CSV</strong>
              <small>Monthly inflow, outflow, and net for the last year</small>
            </span>
            {busy === 'cashflow' ? <Spinner label="Exporting cash flow" /> : <Download size={15} />}
          </button>
          <button type="button" className="export-row" onClick={() => void run('transactions')} disabled={busy !== null}>
            <span>
              <strong>Transactions CSV</strong>
              <small>Every ledger entry for the last year</small>
            </span>
            {busy === 'transactions' ? <Spinner label="Exporting transactions" /> : <Download size={15} />}
          </button>
        </div>
        <p className="hint" style={{ margin: '11px 0 0' }}>
          Exports contain personal data. Store them somewhere you control and delete them when done.
        </p>
      </section>

      <section className="settings-section">
        <h3>Storage</h3>
        <div className="simple-list">
          <div className="settings-inline">
            <div className="settings-inline-main">
              <div className="settings-inline-title"><Database size={14} /> PostgreSQL</div>
              <div className="settings-inline-sub">One owner, one ledger. No external analytics or third-party services.</div>
            </div>
            <StatusPill>Connected</StatusPill>
          </div>
          <div className="settings-inline">
            <div className="settings-inline-main">
              <div className="settings-inline-title"><FileSpreadsheet size={14} /> Portable by default</div>
              <div className="settings-inline-sub">CSV downloads are always available from Reports and here.</div>
            </div>
            <StatusPill tone="accent">CSV</StatusPill>
          </div>
        </div>
      </section>
    </>
  );
}

function AboutPanel({ user }: { user: PublicUser }) {
  const formatDate = useFormatDate();
  const meta = useQuery({
    queryKey: ['meta'],
    queryFn: api.meta,
    staleTime: Infinity,
  });

  return (
    <>
      <h2>About TALLY</h2>
      <p>A private ledger for one person. No data brokers, no trackers, no external analytics.</p>

      <section className="settings-section">
        <div className="about-banner">
          <TallyMark size={34} title="TALLY" />
          <div>
            <Wordmark />
            <p>Every dollar, accounted for.</p>
          </div>
          <StatusPill tone="accent">v{meta.data?.version ?? '1.0.0'}</StatusPill>
        </div>
      </section>

      <section className="settings-section">
        <h3>Privacy by construction</h3>
        <div className="about-grid">
          <div>
            <ShieldCheck size={15} aria-hidden="true" />
            <strong>One owner</strong>
            <span>There are no usernames, invitations, or shared workspaces. A single PIN unlocks the ledger.</span>
          </div>
          <div>
            <KeyRound size={15} aria-hidden="true" />
            <strong>Minimal surface</strong>
            <span>The app keeps only accounts, transactions, categories, budgets, goals, and reports.</span>
          </div>
          <div>
            <Database size={15} aria-hidden="true" />
            <strong>One honest database</strong>
            <span>Everything lives in your own PostgreSQL database on Neon. Nothing is sent elsewhere.</span>
          </div>
          <div>
            <FileSpreadsheet size={15} aria-hidden="true" />
            <strong>Yours to leave</strong>
            <span>Export cash flow and transactions as CSV at any time. Nothing is held behind a proprietary format.</span>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>This workspace</h3>
        <div className="simple-list">
          <div className="settings-inline">
            <div className="settings-inline-main">
              <div className="settings-inline-title">Owner</div>
              <div className="settings-inline-sub">{user.displayName || 'My ledger'}</div>
            </div>
            <span className="hint">Since {formatDate(user.createdAt, 'long')}</span>
          </div>
          <div className="settings-inline">
            <div className="settings-inline-main">
              <div className="settings-inline-title">Runtime</div>
              <div className="settings-inline-sub">Vercel · Hono · Neon PostgreSQL · React</div>
            </div>
            <span className="hint">{meta.data?.version ? `v${meta.data.version}` : 'TALLY'}</span>
          </div>
          <div className="settings-inline">
            <div className="settings-inline-main">
              <div className="settings-inline-title">Currency</div>
              <div className="settings-inline-sub">{currencyLabel(user.currency)}</div>
            </div>
            <StatusPill>{user.currency}</StatusPill>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <p className="hint" style={{ margin: 0 }}>
          TALLY is designed to be understood. The source, schema, and operating notes ship with the application so you can
          audit the ledger you trust.
        </p>
      </section>
    </>
  );
}
