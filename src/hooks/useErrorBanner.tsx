import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ErrorBannerContext {
  error: string | null;
  showError: (msg: string) => void;
  dismissError: () => void;
}

const Ctx = createContext<ErrorBannerContext>({
  error: null,
  showError: () => {},
  dismissError: () => {},
});

export function ErrorBannerProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);

  const showError = useCallback((msg: string) => {
    console.error('[error-banner]', msg);
    setError(msg);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return (
    <Ctx.Provider value={{ error, showError, dismissError }}>
      {children}
    </Ctx.Provider>
  );
}

export function useErrorBanner() {
  return useContext(Ctx);
}
