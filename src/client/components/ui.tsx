import type { FormEvent, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, RefreshCw, X } from 'lucide-react';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
  className = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={`dialog-content ${wide ? 'dialog-wide' : ''} ${className}`.trim()}>
          <div className="dialog-head">
            <div>
              <Dialog.Title className="dialog-title">{title}</Dialog.Title>
              <Dialog.Description className={description ? 'dialog-desc' : 'sr-only'}>
                {description ?? title}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-btn" aria-label="Close dialog">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>
          <div className="dialog-body">{children}</div>
          {footer ? <div className="dialog-foot">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function PageHead({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="hint negative" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  copy,
  action,
}: {
  icon?: ReactNode;
  title: string;
  copy?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <div className="empty-mark">{icon}</div> : null}
      <p className="empty-title">{title}</p>
      {copy ? <p className="empty-copy">{copy}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Could not load this view',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <strong>{title}</strong>
      <div>{message || 'The ledger did not answer. Check the connection and try again.'}</div>
      {onRetry ? (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function LoadingBlock({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="loading-block" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="skeleton" style={{ height: index === 0 ? 18 : 12, width: index === 0 ? '45%' : undefined }} />
      ))}
    </div>
  );
}

export function Spinner({ label = 'Working' }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label} />
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status">
      <AlertCircle size={15} style={{ flex: 'none', marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner label="Deleting" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="hint" style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
        {description}
      </div>
    </Modal>
  );
}

export function submitHandler(handler: () => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handler();
  };
}

export function StatusPill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'warn' | 'negative';
  children: ReactNode;
}) {
  const className =
    tone === 'accent' ? 'badge badge-accent' : tone === 'warn' ? 'badge badge-warn' : tone === 'negative' ? 'badge badge-clay' : 'badge';
  return <span className={className}>{children}</span>;
}
