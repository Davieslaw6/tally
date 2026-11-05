import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { TallyMark, Wordmark } from './components/TallyMark';
import { useSession } from './lib/session';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { PlanPage } from './pages/PlanPage';
import { ReportsPage } from './pages/ReportsPage';
import { AccountsPage } from './pages/AccountsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const { me, loading } = useSession();

  if (loading) {
    return (
      <div className="boot" role="status" aria-label="Opening your ledger">
        <div className="boot-brand">
          <TallyMark size={34} title="TALLY" />
          <Wordmark />
        </div>
        <div className="boot-loader" aria-hidden="true"><span /></div>
        <p className="boot-copy">Opening your ledger…</p>
      </div>
    );
  }

  if (!me) return <AuthPage />;

  return (
    <ErrorBoundary>
      <ScrollToTop />
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppShell>
    </ErrorBoundary>
  );
}

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="page">
      <div className="not-found">
        <p className="not-found-code">404</p>
        <h1 className="page-title">This page slipped off the ledger</h1>
        <p className="page-sub">The address does not match a view in TALLY. Your data is untouched.</p>
        <Link to="/" className="btn btn-primary">Back to the overview</Link>
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TALLY view crashed', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="not-found">
            <TallyMark size={30} title="TALLY" />
            <h1 className="page-title" style={{ marginTop: 18 }}>A view stopped unexpectedly</h1>
            <p className="page-sub">
              Nothing was deleted or changed by this error. Reload the app, and the ledger will load again.
            </p>
            {import.meta.env.DEV ? <pre className="error-trace">{this.state.error.message}</pre> : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload TALLY</button>
              <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Try this view again</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
