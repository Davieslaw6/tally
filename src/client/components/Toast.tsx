import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ToastItem {
  id: number;
  message: string;
  kind: 'success' | 'error' | 'info';
}

interface ToastValue {
  push: (message: string, kind?: ToastItem['kind']) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (message: string, kind: ToastItem['kind'] = 'info') => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-3), { id, message, kind }]);
      window.setTimeout(() => remove(id), kind === 'error' ? 7000 : 4500);
    },
    [remove],
  );

  const value = useMemo<ToastValue>(
    () => ({
      push,
      success: (message: string) => push(message, 'success'),
      error: (message: string) => push(message, 'error'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <div key={item.id} className={`toast ${item.kind === 'error' ? 'error' : ''}`} role={item.kind === 'error' ? 'alert' : 'status'}>
            <span>{item.message}</span>
            <button type="button" onClick={() => remove(item.id)} aria-label="Dismiss notification">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
