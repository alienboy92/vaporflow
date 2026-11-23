import { useEffect, useState, useCallback } from 'react';
import { HashRouter } from 'react-router-dom';
import { DbProvider, useDb, usePlatform } from './context/DbProvider';
import { CloudSyncProvider } from './context/CloudSyncProvider';
import { ShopRepo, SettingsRepo } from '@vaporflow/core';
import { SetupWizard } from './screens/SetupWizard';
import { Shell } from './components/Shell';
import { ToastProvider } from './components/Toast';
import { UpdateProvider } from './context/UpdateProvider';
import { globalErrorLogger } from './utils/logger';

function AppRoot() {
  const db = useDb();
  const platform=usePlatform();
  const [backupPath,setBackupPath]=useState('');
  const [shopConfigured, setShopConfigured] = useState<boolean | null>(null);
  const [pendingJoin, setPendingJoin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState(false);

  const checkSetup = useCallback(async () => {
    setLoading(true);
    setSetupError(false);
    try {
      const shopRepo = new ShopRepo(db);
      setBackupPath(await new SettingsRepo(db).get('last_cloud_backup') ?? '');
      const activeShop = await shopRepo.getActiveShop();
      const pending = Boolean(await new SettingsRepo(db).get('cloud_join_shop'));
      setPendingJoin(pending);
      setShopConfigured(Boolean(activeShop) && !pending);
    } catch (err) {
      globalErrorLogger.log(err);
      setSetupError(true);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void checkSetup();
    const refresh = () => void checkSetup();
    window.addEventListener('vf-enrolled', refresh);
    return () => window.removeEventListener('vf-enrolled', refresh);
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

  if(backupPath) return <main className="vf-card p-6"><h1>Backup verified</h1><p className="break-all">{backupPath}</p>
    {platform.app?.openBackupFolder && <button onClick={()=>void platform.app?.openBackupFolder?.()}>Open backup folder</button>}
    <button onClick={async()=>{await new SettingsRepo(db).set('last_cloud_backup','');setBackupPath('')}}>Continue</button></main>;

  if (!shopConfigured) {
    return <SetupWizard pendingJoin={pendingJoin} onComplete={() => setShopConfigured(true)} />;
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
        <UpdateProvider>
          <ToastProvider>
            <AppRoot />
          </ToastProvider>
        </UpdateProvider>
      </CloudSyncProvider>
    </DbProvider>
  );
}
