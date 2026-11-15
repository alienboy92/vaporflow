import { useEffect, useState, useCallback } from 'react';
import { HashRouter } from 'react-router-dom';
import { DbProvider, useDb } from './context/DbProvider';
import { ShopRepo } from '@vaporflow/core';
import { SetupWizard } from './screens/SetupWizard';
import { Shell } from './components/Shell';
import { globalErrorLogger } from './utils/logger';

function AppRoot() {
  const db = useDb();
  const [shopConfigured, setShopConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const checkSetup = useCallback(async () => {
    try {
      const shopRepo = new ShopRepo(db);
      const activeShop = await shopRepo.getActiveShop();
      setShopConfigured(Boolean(activeShop));
    } catch (err) {
      globalErrorLogger.log(err);
      setShopConfigured(false);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void checkSetup();
  }, [checkSetup]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6" role="status">
        <p className="text-gray-600 font-medium">VaporFlow — Checking shop configuration...</p>
      </main>
    );
  }

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
      <AppRoot />
    </DbProvider>
  );
}
