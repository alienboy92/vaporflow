import { useEffect, useState, useCallback } from 'react';
import { HashRouter } from 'react-router-dom';
import { DbProvider, useDb } from './context/DbProvider';
import { CloudSyncProvider } from './context/CloudSyncProvider';
import { ShopRepo } from '@vaporflow/core';
import { SetupWizard } from './screens/SetupWizard';
import { Shell } from './components/Shell';
import { ToastProvider } from './components/Toast';
import { globalErrorLogger } from './utils/logger';

function AppRoot() {
  const db = useDb();
  const [shopConfigured, setShopConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState(false);

  const checkSetup = useCallback(async () => {
    setLoading(true);
    setSetupError(false);
    try {
      const shopRepo = new ShopRepo(db);
      const activeShop = await shopRepo.getActiveShop();
      setShopConfigured(Boolean(activeShop));
    } catch (err) {
      globalErrorLogger.log(err);
      setSetupError(true);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void checkSetup();
  }, [checkSetup]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6" role="status">
        <p className="font-medium text-slate-600">VaporFlow — Checking shop configuration…</p>
      </main>
    );
  }

  if (setupError)
    return (
      <main className="p-6">
        <p role="alert">Could not read shop configuration. Your saved data has not been changed.</p>
        <button className="min-h-11 px-4 border rounded" onClick={() => void checkSetup()}>
          Retry
        </button>
      </main>
    );

  if (!shopConfigured) {
    return <SetupWizard onComplete={() => setShopConfigured(true)} />;
  }

  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

export function App() {
  return (
    <DbProvider>
      <CloudSyncProvider>
        <ToastProvider>
          <AppRoot />
        </ToastProvider>
      </CloudSyncProvider>
    </DbProvider>
  );
}
