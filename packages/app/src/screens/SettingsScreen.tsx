import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useDb, usePlatform } from '../context/DbProvider';
import {
  ShopRepo,
  DeviceRepo,
  SettingsRepo,
  updatePin,
  exportBackupJson,
  validateBackupJson,
  restoreBackup,
  createVaporFlowSupabaseClient,
  claimShop,
  SupabaseSyncTransport,
  SyncEngine,
} from '@vaporflow/core';
import type { Shop, Device, VfBackup, SyncState } from '@vaporflow/core';
import { resizeLogo } from '../utils/logo';
import { globalErrorLogger } from '../utils/logger';
import { DbCheck } from './DbCheck';

export function SettingsScreen() {
  const db = useDb();
  const platform = usePlatform();
  const [shop, setShop] = useState<Shop | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // PIN state
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMessage, setPinMessage] = useState('');

  // Error log state
  const [logs, setLogs] = useState(globalErrorLogger.getLogs());
  const [copied, setCopied] = useState(false);

  // Backup state
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [pendingBackupData, setPendingBackupData] = useState<VfBackup | null>(null);
  const [backupError, setBackupError] = useState('');
  const [backupSuccess, setBackupSuccess] = useState('');
  const [restoring, setRestoring] = useState(false);
  const restoringRef = useRef(false);

  // Cloud & Sync state
  const [supabaseUrl, setSupabaseUrl] = useState(
    import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co',
  );
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(
    import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key',
  );
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUserEmail, setAuthUserEmail] = useState<string | null>(null);
  const [cloudMessage, setCloudMessage] = useState('');
  const [cloudError, setCloudError] = useState('');
  const [syncState, setSyncState] = useState<SyncState>({
    status: 'offline',
    pendingCount: 0,
    lastSuccessAt: null,
    lastError: null,
    problems: [],
    isSyncing: false,
  });
  const syncEngineRef = useRef<SyncEngine | null>(null);

  const loadData = useCallback(async () => {
    try {
      const shopRepo = new ShopRepo(db);
      const deviceRepo = new DeviceRepo(db);
      const settingsRepo = new SettingsRepo(db);

      const activeShop = await shopRepo.getActiveShop();
      const allSettings = await settingsRepo.getAll();
      const activeDevice = allSettings['active_device_id']
        ? await deviceRepo.getDevice(allSettings['active_device_id'])
        : undefined;

      if (activeShop) setShop(activeShop);
      if (activeDevice) setDevice(activeDevice);
      setSettings(allSettings);
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSaveShop(e: React.FormEvent) {
    e.preventDefault();
    if (!shop) return;
    setError('');
    setMessage('');
    try {
      const shopRepo = new ShopRepo(db);
      const updated: Shop = {
        ...shop,
        updated_at: new Date().toISOString(),
        dirty: 1,
      };
      await shopRepo.saveShop(updated);
      setMessage('Shop settings saved successfully.');
    } catch (err) {
      globalErrorLogger.log(err);
      setError(err instanceof Error ? err.message : 'Failed to save shop settings');
    }
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!shop) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeLogo(file);
      setShop({ ...shop, logo_base64: resized, show_logo_on_receipt: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid logo');
    }
  }

  async function handleSavePin(e: React.FormEvent) {
    e.preventDefault();
    setPinMessage('');
    try {
      const settingsRepo = new SettingsRepo(db);
      await updatePin(settingsRepo, currentPin, newPin);
      window.dispatchEvent(new Event('vaporflow-security-changed'));
      setPinMessage(newPin ? 'PIN updated successfully.' : 'PIN removed successfully.');
      setCurrentPin('');
      setNewPin('');
      void loadData();
    } catch (err) {
      globalErrorLogger.log(err);
      setPinMessage(
        'Could not update PIN. Check the current PIN and use 4–6 digits for a new PIN.',
      );
    }
  }

  async function handleIdleTimeoutChange(minutes: string) {
    try {
      const settingsRepo = new SettingsRepo(db);
      await settingsRepo.set('idle_lock_minutes', minutes);
      window.dispatchEvent(new Event('vaporflow-security-changed'));
      setSettings((prev) => ({ ...prev, idle_lock_minutes: minutes }));
    } catch (err) {
      globalErrorLogger.log(err);
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-gray-600" role="status">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 pb-12">
      <h1 className="text-3xl font-bold text-gray-900">Settings</h1>

      {error && (
        <div role="alert" className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          className="p-4 bg-green-50 text-green-700 rounded border border-green-200"
        >
          {message}
        </div>
      )}

      {shop && (
        <section className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
          <h2 className="text-xl font-semibold text-gray-800">Shop Details</h2>
          <form onSubmit={handleSaveShop} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shop Name</label>
                <input
                  type="text"
                  required
                  className="w-full rounded border border-gray-300 p-3 min-h-11"
                  value={shop.name}
                  onChange={(e) => setShop({ ...shop, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  type="text"
                  className="w-full rounded border border-gray-300 p-3 min-h-11"
                  value={shop.phone || ''}
                  onChange={(e) => setShop({ ...shop, phone: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input
                type="text"
                className="w-full rounded border border-gray-300 p-3 min-h-11"
                value={shop.address || ''}
                onChange={(e) => setShop({ ...shop, address: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Receipt Footer
                </label>
                <input
                  type="text"
                  className="w-full rounded border border-gray-300 p-3 min-h-11"
                  value={shop.receipt_footer}
                  onChange={(e) => setShop({ ...shop, receipt_footer: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Default Low Stock Threshold
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded border border-gray-300 p-3 min-h-11"
                  value={shop.default_low_stock_threshold}
                  onChange={(e) =>
                    setShop({ ...shop, default_low_stock_threshold: Number(e.target.value) })
                  }
                />
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shop Logo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="text-sm text-gray-500"
                />
              </div>
              {shop.logo_base64 && (
                <div className="flex items-center gap-3">
                  <img
                    src={shop.logo_base64}
                    alt="Shop logo"
                    className="h-12 w-12 object-contain border rounded"
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={shop.show_logo_on_receipt === 1}
                      onChange={(e) =>
                        setShop({ ...shop, show_logo_on_receipt: e.target.checked ? 1 : 0 })
                      }
                    />
                    Show on receipt
                  </label>
                  <button
                    type="button"
                    className="text-sm text-red-600 underline"
                    onClick={() => setShop({ ...shop, logo_base64: null, show_logo_on_receipt: 0 })}
                  >
                    Remove logo
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              className="rounded bg-blue-700 text-white px-5 py-3 min-h-11 font-medium hover:bg-blue-800"
            >
              Save Shop Changes
            </button>
          </form>
        </section>
      )}

      {device && (
        <section className="bg-white rounded-xl shadow-sm border p-6 space-y-3">
          <h2 className="text-xl font-semibold text-gray-800">Device Information</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 block">Device Code</span>
              <span className="font-mono font-bold text-lg">{device.code}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Device Name</span>
              <span className="font-medium text-lg">{device.name}</span>
            </div>
          </div>
        </section>
      )}

      {/* Cloud & Sync Section (Phase 8B) */}
      <section className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Cloud Connection & Sync (Supabase)</h2>
        <p className="text-sm text-gray-600">
          Connect your local shop to Supabase to synchronize sales, inventory, and catalog across devices.
        </p>

        {cloudError && (
          <div role="alert" className="p-3 bg-red-50 text-red-700 rounded text-sm border border-red-200">
            {cloudError}
          </div>
        )}
        {cloudMessage && (
          <div role="status" className="p-3 bg-green-50 text-green-700 rounded text-sm border border-green-200">
            {cloudMessage}
          </div>
        )}

        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supabase Project URL</label>
            <input
              type="text"
              className="w-full rounded border border-gray-300 p-3 min-h-11 font-mono text-sm"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              placeholder="https://xxx.supabase.co"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supabase Anon Key</label>
            <input
              type="password"
              className="w-full rounded border border-gray-300 p-3 min-h-11 font-mono text-sm"
              value={supabaseAnonKey}
              onChange={(e) => setSupabaseAnonKey(e.target.value)}
              placeholder="eyJ..."
            />
          </div>

          {!authUserEmail ? (
            <div className="space-y-3 pt-2 border-t">
              <h3 className="font-medium text-gray-800">Cloud Authentication</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  className="w-full rounded border border-gray-300 p-3 min-h-11"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="owner@shop.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  className="w-full rounded border border-gray-300 p-3 min-h-11"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    setCloudError('');
                    setCloudMessage('');
                    try {
                      const client = createVaporFlowSupabaseClient(supabaseUrl, supabaseAnonKey);
                      const { data, error } = await client.auth.signUp({
                        email: authEmail,
                        password: authPassword,
                      });
                      if (error) throw error;
                      if (data.session) {
                        setAuthUserEmail(data.session.user.email ?? authEmail);
                        setCloudMessage('Sign up successful and signed in.');
                      } else {
                        setCloudMessage('Sign up successful. Please check your email for confirmation before signing in.');
                      }
                    } catch (err: unknown) {
                      const msg = err instanceof Error ? err.message : String(err);
                      setCloudError(msg);
                    }
                  }}
                  className="rounded bg-gray-800 text-white px-4 py-2.5 min-h-11 text-sm font-medium hover:bg-gray-900"
                >
                  Sign Up
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setCloudError('');
                    setCloudMessage('');
                    try {
                      const client = createVaporFlowSupabaseClient(supabaseUrl, supabaseAnonKey);
                      const { data, error } = await client.auth.signInWithPassword({
                        email: authEmail,
                        password: authPassword,
                      });
                      if (error) throw error;
                      if (data.session) {
                        setAuthUserEmail(data.session.user.email ?? authEmail);
                        setCloudMessage('Signed in successfully.');
                      }
                    } catch (err: unknown) {
                      const msg = err instanceof Error ? err.message : String(err);
                      setCloudError(msg);
                    }
                  }}
                  className="rounded bg-blue-700 text-white px-4 py-2.5 min-h-11 text-sm font-medium hover:bg-blue-800"
                >
                  Sign In
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">
                  Signed in as <strong className="text-gray-900">{authUserEmail}</strong>
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const client = createVaporFlowSupabaseClient(supabaseUrl, supabaseAnonKey);
                      await client.auth.signOut();
                      setAuthUserEmail(null);
                      setCloudMessage('Signed out.');
                    } catch (err: unknown) {
                      const msg = err instanceof Error ? err.message : String(err);
                      setCloudError(msg);
                    }
                  }}
                  className="text-sm text-red-600 underline font-medium"
                >
                  Sign Out
                </button>
              </div>

              {shop && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      setCloudError('');
                      setCloudMessage('');
                      try {
                        const client = createVaporFlowSupabaseClient(supabaseUrl, supabaseAnonKey);
                        const claimed = await claimShop(client, shop.id);
                        if (claimed) {
                          setCloudMessage('Shop successfully claimed on Supabase cloud!');
                          const transport = new SupabaseSyncTransport(client);
                          const engine = new SyncEngine(db, transport, platform.network, shop.id);
                          syncEngineRef.current = engine;
                          await engine.syncNow();
                          const status = await engine.getStatus();
                          setSyncState(status);
                        } else {
                          setCloudError('Shop claim denied (already claimed by another account).');
                        }
                      } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        setCloudError(msg);
                      }
                    }}
                    className="w-full rounded bg-green-700 hover:bg-green-800 text-white px-5 py-3 font-medium min-h-11 shadow"
                  >
                    Connect Cloud & Claim Shop
                  </button>
                </div>
              )}

              {/* Sync Status and Actions */}
              <div className="pt-4 border-t space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Sync Status:</span>
                  <span className={`font-bold px-2 py-0.5 rounded text-xs uppercase ${
                    syncState.status === 'synced' ? 'bg-green-100 text-green-800' :
                    syncState.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                    syncState.status === 'error' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {syncState.status} {syncState.pendingCount > 0 ? `(${syncState.pendingCount} pending)` : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>Last Success:</span>
                  <span className="font-mono">{syncState.lastSuccessAt ? new Date(syncState.lastSuccessAt).toLocaleTimeString() : 'Never'}</span>
                </div>
                {syncState.lastError && (
                  <div className="p-2 bg-red-50 text-red-700 text-xs rounded border border-red-200">
                    Error: {syncState.lastError}
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!shop) return;
                      try {
                        const client = createVaporFlowSupabaseClient(supabaseUrl, supabaseAnonKey);
                        const transport = new SupabaseSyncTransport(client);
                        const engine = new SyncEngine(db, transport, platform.network, shop.id);
                        await engine.syncNow();
                        const st = await engine.getStatus();
                        setSyncState(st);
                        setCloudMessage('Sync completed successfully.');
                      } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        setCloudError(msg);
                      }
                    }}
                    className="rounded bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 text-sm font-medium min-h-11"
                  >
                    Sync Now
                  </button>
                </div>

                {syncState.problems.length > 0 && (
                  <div className="pt-2 space-y-1">
                    <h4 className="text-xs font-bold text-red-700 uppercase">Actionable Sync Problems</h4>
                    {syncState.problems.map((p, idx) => (
                      <div key={idx} className="p-2 bg-red-50 text-red-800 text-xs rounded border border-red-200 flex justify-between items-center">
                        <div>
                          <strong>{p.table}</strong> ({p.id.slice(0, 8)}...): {p.error}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Security & PIN Lock</h2>
        {pinMessage && <p className="text-sm font-medium text-blue-700">{pinMessage}</p>}
        <form onSubmit={handleSavePin} className="space-y-4 max-w-md">
          {settings['pin_hash'] && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current PIN</label>
              <input
                type="password"
                maxLength={6}
                className="w-full rounded border border-gray-300 p-3 min-h-11"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
                placeholder="Enter current PIN"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {settings['pin_hash'] ? 'New PIN (leave blank to remove)' : 'Set PIN (4 to 6 digits)'}
            </label>
            <input
              type="password"
              maxLength={6}
              className="w-full rounded border border-gray-300 p-3 min-h-11"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder="••••"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Idle Auto-Lock</label>
            <select
              className="w-full rounded border border-gray-300 p-3 min-h-11 bg-white"
              value={settings['idle_lock_minutes'] || '0'}
              onChange={(e) => void handleIdleTimeoutChange(e.target.value)}
            >
              <option value="0">Never (Disabled)</option>
              <option value="5">After 5 minutes</option>
              <option value="15">After 15 minutes</option>
              <option value="30">After 30 minutes</option>
            </select>
          </div>

          <button
            type="submit"
            className="rounded bg-blue-700 text-white px-5 py-3 min-h-11 font-medium hover:bg-blue-800"
          >
            Update PIN Settings
          </button>
        </form>
      </section>

      <section className="bg-white rounded-xl shadow-sm border p-6 space-y-3">
        <h2 className="text-xl font-semibold text-gray-800">Application Information</h2>
        <div className="text-sm space-y-1 text-gray-600">
          <p>App Name: VaporFlow POS</p>
          <p>Version: 1.0.0 (Phase 8B)</p>
          <p>Platform: Desktop / Android</p>
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-800">Error Log (Last 100)</h2>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const text = logs
                  .map((l) => `[${l.timestamp}] ${l.message}\n${l.stack || ''}`)
                  .join('\n---\n');
                navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded border px-4 py-2 text-sm font-medium hover:bg-gray-50 min-h-11"
            >
              {copied ? 'Copied to clipboard!' : 'Copy logs'}
            </button>
            <button
              onClick={() => {
                globalErrorLogger.clear();
                setLogs([]);
              }}
              className="rounded border px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 min-h-11"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="bg-gray-900 text-green-400 font-mono text-xs p-4 rounded h-48 overflow-y-auto">
          {logs.length === 0 ? (
            <span className="text-gray-500">No errors logged.</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="mb-2">
                <span className="text-gray-400">[{log.timestamp}]</span> {log.message}
                {log.stack && (
                  <div className="text-gray-500 text-[10px] whitespace-pre-wrap">{log.stack}</div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Backup & Restore</h2>
        <p className="text-sm text-gray-600">
          Export a versioned .vfbackup JSON file containing all synced shop data, or restore from a previous backup. Restoring replaces local synced data.
        </p>

        {backupError && (
          <div role="alert" className="p-3 bg-red-50 text-red-700 rounded text-sm border border-red-200">
            {backupError}
          </div>
        )}
        {backupSuccess && (
          <div role="status" className="p-3 bg-green-50 text-green-700 rounded text-sm border border-green-200">
            {backupSuccess}
          </div>
        )}

        <div className="flex flex-wrap gap-4 pt-2">
          <button
            onClick={async () => {
              if (!shop) return;
              setBackupError('');
              setBackupSuccess('');
              try {
                const jsonStr = await exportBackupJson(db, shop.id);
                await platform.share.shareFile(
                  `vaporflow_backup_${new Date().toISOString().slice(0, 10)}.vfbackup`,
                  jsonStr,
                  'application/json',
                );
                setBackupSuccess('Backup exported successfully.');
              } catch (err) {
                globalErrorLogger.log(err);
                setBackupError('Failed to export backup');
              }
            }}
            className="rounded bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 font-medium min-h-11 shadow"
          >
            Export Backup (.vfbackup)
          </button>

          <div>
            <label className="rounded border bg-white hover:bg-gray-50 text-gray-700 px-5 py-2.5 font-medium min-h-11 inline-flex items-center cursor-pointer shadow-sm">
              <span>Restore Backup...</span>
              <input
                type="file"
                accept=".vfbackup,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBackupError('');
                  setBackupSuccess('');
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    const content = event.target?.result as string;
                    if (!content) return;
                    const val = validateBackupJson(content);
                    if (!val.success || !val.data) {
                      setBackupError(val.error || 'Invalid backup file');
                      return;
                    }
                    setPendingBackupData(val.data);
                    setRestoreModalOpen(true);
                  };
                  reader.readAsText(file);
                }}
              />
            </label>
          </div>
        </div>
      </section>

      {/* Restore Confirmation Modal */}
      {restoreModalOpen && pendingBackupData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <h3 className="text-xl font-bold text-gray-900">Confirm Backup Restore</h3>
            <p className="text-sm text-gray-600">
              You are about to restore backup from <span className="font-mono">{new Date(pendingBackupData.exported_at).toLocaleString()}</span> (App version: {pendingBackupData.app_version}).
            </p>
            <div className="p-3 bg-amber-50 text-amber-800 rounded-lg text-sm border border-amber-200">
              ⚠️ Warning: Restoring this backup will replace all current local synced data (products, sales, stock, expenses) with the backup contents. Local device identity and PIN are preserved.
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <p>Products in backup: {pendingBackupData.tables.products.length}</p>
              <p>Sales in backup: {pendingBackupData.tables.sales.length}</p>
              <p>Expenses in backup: {pendingBackupData.tables.expenses.length}</p>
            </div>
            <div className="flex justify-end gap-3 pt-3 border-t">
              <button
                onClick={() => {
                  setRestoreModalOpen(false);
                  setPendingBackupData(null);
                }}
                className="px-4 py-2.5 border rounded-lg text-gray-700 hover:bg-gray-100 min-h-11 font-medium"
              >
                Cancel
              </button>
              <button
                disabled={restoring}
                onClick={async () => {
                  if (!pendingBackupData || restoringRef.current) return;
                  restoringRef.current = true;
                  setRestoring(true);
                  try {
                    await restoreBackup(db, pendingBackupData);
                    setRestoreModalOpen(false);
                    setPendingBackupData(null);
                    setBackupSuccess('Backup restored successfully. Reloading...');
                    setTimeout(() => {
                      window.location.reload();
                    }, 1500);
                  } catch (err) {
                    globalErrorLogger.log(err);
                    setBackupError(err instanceof Error ? err.message : 'Restore failed');
                    setRestoreModalOpen(false);
                  } finally {
                    restoringRef.current = false;
                    setRestoring(false);
                  }
                }}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg min-h-11 font-medium shadow"
              >
                {restoring ? 'Restoring...' : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Development Diagnostics</h2>
        <DbCheck />
      </section>
    </div>
  );
}
