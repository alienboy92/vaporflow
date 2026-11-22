import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** App-wide transient feedback, mirroring the prototype's toast banner. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = (nextId.current += 1);
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 2800);
    timers.current.push(timer);
  }, []);

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    },
    [],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg ${
              toast.tone === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : toast.tone === 'info'
                  ? 'border-slate-200 bg-white text-slate-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${
                toast.tone === 'error'
                  ? 'bg-rose-500'
                  : toast.tone === 'info'
                    ? 'bg-slate-400'
                    : 'bg-emerald-500'
              }`}
            />
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * No-op fallback: screens stay renderable in isolated tests and during setup
 * before the provider mounts.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  return api ?? { show: () => undefined };
}
