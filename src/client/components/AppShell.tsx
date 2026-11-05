import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  ChartNoAxesColumn,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Target,
  X,
} from 'lucide-react';
import { currentMonth, initials } from '../lib/finance';
import { useSession } from '../lib/session';
import { TallyMark, Wordmark } from './TallyMark';
import { useDocumentTitle } from '../lib/hooks';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/plan', label: 'Plan', icon: Target },
  { to: '/reports', label: 'Reports', icon: ChartNoAxesColumn },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, settings, signOut } = useSession();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useDocumentTitle(titleForPath(location.pathname));

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  useEffect(() => {
    void currentMonth(user?.timezone);
  }, [user?.timezone]);

  const displayName = user?.displayName || 'My ledger';

  const logout = async () => {
    setSigningOut(true);
    try {
      await signOut();
      queryClient.clear();
    } finally {
      setSigningOut(false);
    }
  };

  const nav = (
    <nav className="side-nav" aria-label="Primary">
      {NAV.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
      <NavLink to="/settings" className="nav-link">
        <Settings aria-hidden="true" />
        <span>Settings</span>
      </NavLink>
    </nav>
  );

  const sidebarFooter = (
    <>
      <div className="side-spacer" />
      <p className="tagline">Every dollar, accounted for.</p>
      <div className="user-row">
        <NavLink to="/settings" className="user-row-main">
          <span className="avatar" aria-hidden="true">
            {initials(displayName)}
          </span>
          <span className="user-meta">
            <span className="user-name">{displayName}</span>
            <span className="user-sub">
              {user?.currency ?? 'USD'} · {settings?.theme ?? 'light'} theme
            </span>
          </span>
          <span className="sr-only"> — open profile settings</span>
        </NavLink>
        <button
          type="button"
          className="icon-btn"
          aria-label="Sign out"
          title="Sign out"
          disabled={signingOut}
          onClick={() => void logout()}
        >
          <LogOut size={15} />
        </button>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand-row" aria-label="TALLY overview">
          <TallyMark size={25} title="TALLY" />
          <Wordmark />
        </NavLink>
        <p className="scope">Personal ledger · one owner</p>
        {nav}
        {sidebarFooter}
      </aside>

      <div className="main">
        <div className="mobile-bar">
          <NavLink to="/" className="brand-row" aria-label="TALLY overview">
            <TallyMark size={23} title="TALLY" />
            <Wordmark />
          </NavLink>
          <div className="mobile-actions">
            <button
              type="button"
              className="mobile-menu-button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
            >
              <Menu size={19} />
            </button>
          </div>
        </div>
        {mobileOpen ? (
          <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label="Navigation">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="brand-row">
                <TallyMark size={25} title="TALLY" />
                <Wordmark />
              </div>
              <button
                type="button"
                className="mobile-menu-button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <X size={19} />
              </button>
            </div>
            <div style={{ marginTop: 18 }}>{nav}</div>
            <div className="side-spacer" />
            <p className="tagline">Every dollar, accounted for.</p>
            <NavLink to="/settings" className="user-row" onClick={() => setMobileOpen(false)}>
              <span className="avatar" aria-hidden="true">
                {initials(displayName)}
              </span>
              <span className="user-meta">
                <span className="user-name">{displayName}</span>
                <span className="user-sub">
                  {settings?.theme ?? 'light'} · {user?.currency ?? 'USD'}
                </span>
              </span>
            </NavLink>
            <button
              type="button"
              className="btn btn-quiet btn-wide"
              style={{ marginTop: 10 }}
              onClick={() => void logout()}
              disabled={signingOut}
            >
              <LogOut size={15} /> {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        ) : null}
        <main>{children}</main>
      </div>
    </div>
  );
}

function titleForPath(path: string): string {
  if (path === '/') return 'Overview';
  if (path.startsWith('/transactions')) return 'Transactions';
  if (path.startsWith('/plan')) return 'Plan';
  if (path.startsWith('/reports')) return 'Reports';
  if (path.startsWith('/accounts')) return 'Accounts';
  if (path.startsWith('/settings')) return 'Settings';
  return '';
}
