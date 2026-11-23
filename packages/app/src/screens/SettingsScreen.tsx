import { ScannerSettings } from '../components/ScannerSettings';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useDb, usePlatform } from '../context/DbProvider';
import {
  ShopRepo,
  DeviceRepo,
  SettingsRepo,
  updatePin,
  exportBackupJson,
  validateBackupJson,
  resetLocalDatabase,
  APP_VERSION,
} from '@vaporflow/core';
import type { Shop, Device, VfBackup } from '@vaporflow/core';
import { useCloudSync } from '../context/CloudSyncProvider';
import { resizeLogo } from '../utils/logo';
import { globalErrorLogger } from '../utils/logger';
import { registerBackHandler } from '../utils/back-nav';
import { useToast } from '../components/Toast';
import { useUpdates } from '../context/UpdateProvider';

export function SettingsScreen() {
  const db = useDb();
  const platform = usePlatform();
  const toast = useToast();
  const updates = useUpdates();
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

  // Clear Data state: full local reset back to the setup wizard.
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);
  const resettingRef = useRef(false);
  const [resetError, setResetError] = useState('');

  // Cloud & Sync state — session/engine/status live in CloudSyncProvider;
  // only the form inputs and transient messages are local here.
  const sync = useCloudSync();
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [localCopies, setLocalCopies] = useState<Record<string,unknown>>({});
  const [changeStep,setChangeStep]=useState<''|'choose'|'keep'|'delete'>('');
  const dialogRef=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(changeStep && !dialogRef.current?.open) dialogRef.current?.showModal();},[changeStep]);
  const [typedDelete,setTypedDelete]=useState('');
  async function saveConnection(choice?:'keep'|'backup'|'delete') {
    try {
      setCloudError('');
      await sync.saveConfig(supabaseUrl,supabaseAnonKey,choice,typedDelete);
      setChangeStep('');setCloudMessage('Supabase configuration saved.');
    } catch(error) {
      if(error instanceof Error && error.message==='CLOUD_CHOICE_REQUIRED') setChangeStep('choose');
      else setCloudError(error instanceof Error?error.message:'Connection failed.');
    }
  }
  const [cloudMessage, setCloudMessage] = useState('');
  const [cloudError, setCloudError] = useState('');
  const [copiedShopId, setCopiedShopId] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);

  // Editable device code (receipt prefix). 2–4 uppercase letters/digits.
  const [deviceCode, setDeviceCode] = useState('');
  const [savingDeviceCode, setSavingDeviceCode] = useState(false);

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

      if (activeShop) {
        setShop(activeShop);
        setDevices(await deviceRepo.getDevices(activeShop.id));
      }
      if (activeDevice) {
        setDevice(activeDevice);
        setDeviceCode(activeDevice.code);
      }
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

  // Android back button: close the restore-confirmation modal first.
  useEffect(() => {
    if (!restoreModalOpen) return;
    return registerBackHandler(() => {
      setRestoreModalOpen(false);
      return true;
    });
  }, [restoreModalOpen]);

  // The clear-data confirmation is also dismissible with the back button.
  useEffect(() => {
    if (!resetModalOpen) return;
    return registerBackHandler(() => {
      if (resettingRef.current) return true;
      setResetModalOpen(false);
      return true;
    });
  }, [resetModalOpen]);

  // Wraps every cloud action so errors land in the panel instead of vanishing.
  async function runCloudAction(action: () => Promise<void>, successMessage?: string) {
    setCloudError('');
    setCloudMessage('');
    try {
      await action();
      if (successMessage) setCloudMessage(successMessage);
    } catch (err: unknown) {
      setCloudError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCopyShopId() {
    if (!shop) return;
    try {
      await navigator.clipboard.writeText(shop.id);
      setCopiedShopId(true);
      window.setTimeout(() => setCopiedShopId(false), 2000);
    } catch {
      setCloudError('Could not copy automatically; select the Shop ID text manually.');
    }
  }

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

  async function handleSaveDeviceCode(e: React.FormEvent) {
    e.preventDefault();
    if (!device) return;
    const code = deviceCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,4}$/.test(code)) {
      setError('Device code must be 2–4 letters or digits (A–Z, 0–9).');
      return;
    }
    if (code === device.code) {
      setDeviceCode(device.code);
      return;
    }
    if (!window.confirm(`Change this device's code from ${device.code} to ${code}? Future receipt numbers will use the new code.`)) {
      setDeviceCode(device.code);
      return;
    }
    setSavingDeviceCode(true);
    setError('');
    try {
      const updated: Device = {
        ...device,
        code,
        updated_at: new Date().toISOString(),
        dirty: 1,
      };
      await new DeviceRepo(db).saveDevice(updated);
      setDevice(updated);
      toast.show('Device code updated');
    } catch (err) {
      globalErrorLogger.log(err);
      setError(err instanceof Error ? err.message : 'Failed to update device code');
      setDeviceCode(device.code);
    } finally {
      setSavingDeviceCode(false);
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

  /**
   * Full local reset: drops every local table, re-runs migrations, clears the
   * few browser preferences, then reloads into the setup wizard. Only allowed
   * while no cloud account is signed in (the button is disabled otherwise).
   */
  async function handleClearData() {
    if (resettingRef.current) return;
    if (resetConfirm.trim().toUpperCase() !== 'DELETE') {
      setResetError('Type DELETE to confirm.');
      return;
    }
    setResetError('');
    resettingRef.current = true;
    setResetting(true);
    try {
      await resetLocalDatabase(db);
      // Preferences (e.g. wedge mode) live in localStorage; storage may be
      // unavailable, which must not mask a successful database reset.
      try {
        localStorage.clear();
      } catch {
        // Ignore: the database is already reset.
      }
      window.location.reload();
    } catch (err) {
      globalErrorLogger.log(err);
      setResetError(err instanceof Error ? err.message : 'Could not clear local data.');
      resettingRef.current = false;
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <div className="vf-page text-sm text-slate-500" role="status">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="vf-page pb-12">
      <p className="vf-sub">Shop, device, security, backup and sync configuration.</p>

      {error && (
        <div role="alert" className="p-4 bg-rose-50 text-rose-700 rounded-xl border border-rose-200">
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          className="p-4 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-200"
        >
          {message}
        </div>
      )}

      {shop && (
        <section className="vf-card space-y-4 p-5">
          <h2 className="vf-title">Shop Details</h2>
          <form onSubmit={handleSaveShop} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="vf-label">Shop Name</label>
                <input
                  type="text"
                  required
                  className="vf-input"
                  value={shop.name}
                  onChange={(e) => setShop({ ...shop, name: e.target.value })}
                />
              </div>
              <div>
                <label className="vf-label">Phone</label>
                <input
                  type="text"
                  className="vf-input"
                  value={shop.phone || ''}
                  onChange={(e) => setShop({ ...shop, phone: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="vf-label">Address</label>
              <input
                type="text"
                className="vf-input"
                value={shop.address || ''}
                onChange={(e) => setShop({ ...shop, address: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="vf-label">
                  Receipt Footer
                </label>
                <input
                  type="text"
                  className="vf-input"
                  value={shop.receipt_footer}
                  onChange={(e) => setShop({ ...shop, receipt_footer: e.target.value })}
                />
              </div>
              <div>
                <label className="vf-label">
                  Default Low Stock Threshold
                </label>
                <input
                  type="number"
                  min={0}
                  className="vf-input"
                  value={shop.default_low_stock_threshold}
                  onChange={(e) =>
                    setShop({ ...shop, default_low_stock_threshold: Number(e.target.value) })
                  }
                />
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <div>
                <label className="vf-label">Shop Logo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="vf-sub"
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
                    className="text-sm text-rose-600 underline"
                    onClick={() => setShop({ ...shop, logo_base64: null, show_logo_on_receipt: 0 })}
                  >
                    Remove logo
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              className="vf-btn-primary"
            >
              Save Shop Changes
            </button>
          </form>
        </section>
      )}

      {device && (
        <section className="vf-card space-y-4 p-5">
          <h2 className="vf-title">Device Information</h2>
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <span className="block text-slate-500">Device Name</span>
              <span className="text-lg font-medium text-slate-900">{device.name}</span>
            </div>
            <form onSubmit={handleSaveDeviceCode} className="space-y-2">
              <label className="vf-label" htmlFor="device-code">
                Device Code (receipt prefix)
              </label>
              <div className="flex gap-2">
                <input
                  id="device-code"
                  type="text"
                  value={deviceCode}
                  maxLength={4}
                  onChange={(e) => setDeviceCode(e.target.value.toUpperCase())}
                  className="vf-input vf-num w-28 uppercase"
                  aria-describedby="device-code-hint"
                  required
                />
                <button
                  type="submit"
                  disabled={savingDeviceCode || deviceCode.trim().toUpperCase() === device.code}
                  className="vf-btn-ghost"
                >
                  {savingDeviceCode ? 'Saving…' : 'Save'}
                </button>
              </div>
              <p id="device-code-hint" className="vf-sub">
                2–4 letters or digits. Used in future receipt numbers.
              </p>
            </form>
          </div>
        </section>
      )}

      <section className="vf-card space-y-4 p-5">
        <h2 className="vf-title">Cloud Connection & Sync (Supabase)</h2>
        <p className="vf-sub">
          Connect your local shop to Supabase to synchronize sales, inventory, and catalog across devices.
        </p>

        {shop && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm flex items-center justify-between gap-3 max-w-lg">
            <div className="min-w-0">
              <span className="block text-xs font-medium uppercase text-slate-500">
                Shop ID — share with second devices
              </span>
              <span className="font-mono text-xs break-all">{shop.id}</span>
            </div>
            <button
              type="button"
              onClick={() => void handleCopyShopId()}
              className="vf-btn-ghost min-h-10 shrink-0 px-3 text-xs"
            >
              {copiedShopId ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        {cloudError && (
          <div role="alert" className="p-3 bg-rose-50 text-rose-700 rounded-xl text-sm border border-rose-200">
            {cloudError}
          </div>
        )}
        {cloudMessage && (
          <div role="status" className="p-3 bg-emerald-50 text-emerald-700 rounded-xl text-sm border border-emerald-200">
            {cloudMessage}
          </div>
        )}

        <div className="space-y-4 max-w-lg">
          <div>
            <label className="vf-label">Supabase Project URL</label>
            <input
              type="text"
              className="vf-input font-mono text-sm"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              placeholder="https://xxx.supabase.co"
            />
          </div>
          <div>
            <label className="vf-label">Supabase Anon Key</label>
            <input
              type="password"
              className="vf-input font-mono text-sm"
              value={supabaseAnonKey}
              onChange={(e) => setSupabaseAnonKey(e.target.value)}
              placeholder="eyJ..."
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={sync.busy}
              onClick={() => void saveConnection()}
              className="vf-btn-primary min-h-10 px-3.5 text-sm"
            >
              Save Configuration
            </button>
            {sync.configured && <span className="text-sm text-green-700 font-medium">Credentials saved ✓</span>}
          </div>

          {changeStep && <dialog ref={dialogRef} onCancel={event=>{event.preventDefault();if(!sync.busy)setChangeStep('')}} className="vf-card fixed inset-0 z-50 m-auto p-6 max-w-md" aria-label="Change cloud connection">
            {changeStep==='choose' ? <>
              <p>Changing the cloud project can send this device&apos;s data to the new project or lose it. Choose what to do with the data on this device.</p>
              <button disabled={sync.busy} onClick={()=>setChangeStep('keep')}>Keep data</button>
              <button disabled={sync.busy} onClick={()=>void saveConnection('backup')}>Back up, then start fresh</button>
              <button disabled={sync.busy} onClick={()=>{setTypedDelete('');setChangeStep('delete')}}>Delete data and start fresh</button>
            </> : changeStep==='keep' ? <>
              <p>After backup, all existing local shop data will be uploaded to the new project when you sign in.</p>
              <button disabled={sync.busy} onClick={()=>void saveConnection('keep')}>Confirm upload</button>
            </> : <><label>Type DELETE to erase this device without a backup<input value={typedDelete} onChange={e=>setTypedDelete(e.target.value)}/></label>
              <button disabled={sync.busy || typedDelete!=='DELETE'} onClick={()=>void saveConnection('delete')}>Confirm deletion</button></>}
            {cloudError && <p role="alert">{cloudError}</p>}
            <button disabled={sync.busy} onClick={()=>{setChangeStep('');setTypedDelete('');setCloudError('')}}>Cancel</button>
          </dialog>}
          {!sync.email ? (
            <div className="space-y-3 pt-2 border-t">
              <h3 className="font-semibold text-slate-800">Cloud Authentication</h3>
              <div>
                <label className="vf-label">Email</label>
                <input
                  type="email"
                  className="vf-input"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="owner@shop.com"
                />
              </div>
              <div>
                <label className="vf-label">Password</label>
                <input
                  type="password"
                  className="vf-input"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  disabled={sync.busy || !sync.configured}
                  onClick={() =>
                    void runCloudAction(async () => {
                      const result = await sync.signUp(authEmail.trim(), authPassword);
                      setCloudMessage(
                        result === 'signed-in'
                          ? 'Signed up and signed in.'
                          : 'Sign up successful. Check your email for confirmation before signing in.',
                      );
                    })
                  }
                  className="vf-btn-dark"
                >
                  Sign Up
                </button>
                <button
                  type="button"
                  disabled={sync.busy || !sync.configured}
                  onClick={() =>
                    void runCloudAction(
                      () => sync.signIn(authEmail.trim(), authPassword),
                      'Signed in successfully.',
                    )
                  }
                  className="vf-btn-primary min-h-10 px-3.5 text-sm"
                >
                  Sign In
                </button>
              </div>
              {!sync.configured && (
                <p className="text-xs text-amber-700">
                  Save the Supabase URL and anon key above before signing in.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700">
                  Signed in as <strong className="text-slate-900">{sync.email}</strong>
                </span>
                <button
                  type="button"
                  disabled={sync.busy}
                  onClick={() => void runCloudAction(() => sync.signOut(), 'Signed out.')}
                  className="text-sm font-medium text-rose-600 underline disabled:opacity-50"
                >
                  Sign Out
                </button>
              </div>

              {shop && !sync.enrolledShopId && (
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={sync.busy || !sync.configured}
                    onClick={() =>
                      void runCloudAction(
                        () => sync.claimAndConnect(),
                        'Shop claimed on Supabase — cloud sync is now running automatically.',
                      )
                    }
                    className="vf-btn-primary w-full"
                  >
                    {sync.busy ? 'Working...' : 'Connect Cloud & Claim Shop'}
                  </button>
                </div>
              )}

              {sync.enrolledShopId && (
                <>
                  <div className="flex items-center justify-between text-sm pt-2">
                    <span className="text-slate-700">
                      Connected to shop <span className="font-mono text-xs">{sync.enrolledShopId.slice(0, 8)}…</span>
                    </span>
                    <span className={`font-bold px-2 py-0.5 rounded text-xs uppercase ${
                      sync.status.status === 'synced' ? 'bg-emerald-100 text-emerald-800' :
                      sync.status.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                      sync.status.status === 'error' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-800'
                    }`}>
                      {sync.status.status} {sync.status.pendingCount > 0 ? `(${sync.status.pendingCount} pending)` : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>Last Success:</span>
                    <span className="font-mono">{sync.status.lastSuccessAt ? new Date(sync.status.lastSuccessAt).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) : 'Never'}</span>
                  </div>
                  {sync.status.lastError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                      Error: {sync.status.lastError}
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      disabled={sync.busy || sync.status.isSyncing}
                      onClick={() =>
                        void runCloudAction(() => sync.syncNow(), 'Sync completed successfully.')
                      }
                      className="vf-btn-primary min-h-10 px-3.5 text-sm"
                    >
                      {sync.status.isSyncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                  </div>

                  {sync.status.problems.length > 0 && (
                    <div className="pt-2 space-y-1">
                      <h4 className="text-xs font-bold uppercase text-rose-700">Actionable Sync Problems</h4>
                      {sync.status.problems.map((p, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                          <div>
                            <strong>{p.table}</strong> ({p.id.slice(0, 8)}...): {p.error}
                            <details onToggle={event => {
                              if (event.currentTarget.open && p.kind === 'conflict') {
                                void sync.localCopy(p).then(row => setLocalCopies(previous => ({...previous,[p.table+p.id]:row}))).catch(() => setCloudError('Could not read the local record.'));
                              }
                            }}><summary>Review record</summary>
                              {p.kind === 'conflict' && <><p>This device</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify(localCopies[p.table+p.id], null, 2)}</pre></>}
                              <p>Cloud revision {p.version} · {p.timestamp}</p>
                              <pre className="whitespace-pre-wrap break-all">{JSON.stringify(p.row, null, 2)}</pre>
                              {p.kind === 'conflict' && <p>Keep mine sends this device’s current edit. Keep theirs replaces it with the cloud revision above.</p>}
                              {(p.kind === 'conflict' ? (['mine','theirs'] as const) : (['retry'] as const)).map(action =>
                                <button type="button" className="vf-btn-ghost" disabled={sync.busy} key={action}
                                  onClick={() => void runCloudAction(() => sync.handleProblem(p, action), 'Review the updated sync status.')}>
                                  {{mine:'Keep mine',theirs:'Keep theirs',retry:'Retry'}[action]}
                                </button>)}
                            </details>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {devices.length > 0 && (
                    <div className="pt-2 space-y-1">
                      <h4 className="text-xs font-bold uppercase text-slate-700">Registered Devices</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {devices.map((d) => (
                          <div key={d.id} className="p-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2">
                            <span className="font-mono font-bold">{d.code}</span>
                            <span className="truncate text-slate-600">{d.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="vf-card space-y-4 p-5">
        <h2 className="vf-title">Security & PIN Lock</h2>
        {pinMessage && <p className="text-sm font-medium text-emerald-700">{pinMessage}</p>}
        <form onSubmit={handleSavePin} className="space-y-4 max-w-md">
          {settings['pin_hash'] && (
            <div>
              <label className="vf-label">Current PIN</label>
              <input
                type="password"
                maxLength={6}
                className="vf-input"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
                placeholder="Enter current PIN"
              />
            </div>
          )}
          <div>
            <label className="vf-label">
              {settings['pin_hash'] ? 'New PIN (leave blank to remove)' : 'Set PIN (4 to 6 digits)'}
            </label>
            <input
              type="password"
              maxLength={6}
              className="vf-input"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder="••••"
            />
          </div>

          <div>
            <label className="vf-label">Idle Auto-Lock</label>
            <select
              className="vf-select"
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
            className="vf-btn-primary"
          >
            Update PIN Settings
          </button>
        </form>
      </section>

      <ScannerSettings />
      <section className="vf-card space-y-3 p-5">
        <h2 className="vf-title">Application Information</h2>
        <div className="space-y-1 text-sm text-slate-600">
          <p>App Name: VaporFlow POS</p>
          <p>Version: {APP_VERSION}</p>
          <p>{platform.platform === 'desktop' ? 'Platform: Windows desktop' : 'Platform: Android'}</p>
        </div>
      </section>

      <section className="vf-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="vf-title">Software Updates</h2>
          <span
            className={`vf-badge ${
              updates.status === 'available'
                ? 'vf-badge-amber'
                : updates.status === 'current'
                  ? 'vf-badge-green'
                  : updates.status === 'error'
                    ? 'vf-badge-rose'
                    : 'vf-badge-slate'
            }`}
          >
            {updates.status === 'checking'
              ? 'Checking…'
              : updates.status === 'available'
                ? 'Update available'
                : updates.status === 'current'
                  ? 'Up to date'
                  : updates.status === 'error'
                    ? 'Check failed'
                    : 'Not checked'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <span className="vf-sub block">Current version</span>
            <span className="vf-num font-semibold text-slate-900">{APP_VERSION}</span>
          </div>
          <div>
            <span className="vf-sub block">Latest version</span>
            <span className="vf-num font-semibold text-slate-900">
              {updates.info?.latestVersion ?? '—'}
            </span>
          </div>
          <div>
            <span className="vf-sub block">Last checked</span>
            <span className="text-slate-700">
              {updates.lastChecked
                ? new Date(updates.lastChecked).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })
                : 'Not checked yet'}
            </span>
          </div>
        </div>

        {updates.status === 'available' && updates.info && (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              Version <strong>{updates.info.latestVersion}</strong> is available. Installing it
              keeps your shop data on this device.
            </p>
            {updates.info.sha256 && <p className="break-all text-xs">Download SHA-256 · {updates.info.sha256}</p>}
            {updates.info.notes && (
              <details>
                <summary className="cursor-pointer font-semibold">Release notes</summary>
                <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs">
                  {updates.info.notes}
                </p>
              </details>
            )}
          </div>
        )}

        {updates.status === 'current' && (
          <p className="text-sm text-emerald-700">You are running the latest version.</p>
        )}

        {updates.error && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {updates.error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={updates.status === 'checking'}
            onClick={() => void updates.check(true)}
            className="vf-btn-ghost"
          >
            {updates.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          {updates.status === 'available' && updates.info && (
            <button
              type="button"
              onClick={() => void updates.openDownload()}
              className="vf-btn-primary"
            >
              Download update
            </button>
          )}
        </div>
        <p className="vf-sub">
          Downloads open in your browser. Run the new installer on Windows or open the APK on
          Android; your data stays on this device and is upgraded automatically.
        </p>
      </section>

      <section className="vf-card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="vf-title">Error Log (Last 100)</h2>
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
              className="vf-btn-ghost"
            >
              {copied ? 'Copied to clipboard!' : 'Copy logs'}
            </button>
            <button
              onClick={() => {
                globalErrorLogger.clear();
                setLogs([]);
              }}
              className="vf-btn-danger"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="h-48 overflow-y-auto rounded-xl bg-slate-900 p-4 font-mono text-xs text-emerald-400">
          {logs.length === 0 ? (
            <span className="text-slate-500">No errors logged.</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="mb-2">
                <span className="text-slate-400">[{log.timestamp}]</span> {log.message}
                {log.stack && (
                  <div className="whitespace-pre-wrap text-[10px] text-slate-500">{log.stack}</div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="vf-card space-y-4 p-5">
        <h2 className="vf-title">Backup & Restore</h2>
        <p className="vf-sub">
          Export a versioned .vfbackup JSON file containing all synced shop data, or restore from a previous backup. Restoring replaces local synced data.
        </p>

        {backupError && (
          <div role="alert" className="p-3 bg-rose-50 text-rose-700 rounded-xl text-sm border border-rose-200">
            {backupError}
          </div>
        )}
        {backupSuccess && (
          <div role="status" className="p-3 bg-emerald-50 text-emerald-700 rounded-xl text-sm border border-emerald-200">
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
            className="vf-btn-primary"
          >
            Export Backup (.vfbackup)
          </button>

          <div>
            <label className="vf-btn-ghost cursor-pointer">
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

      <section className="vf-card space-y-4 border-rose-200 p-5">
        <h2 className="text-xl font-semibold text-rose-700">Danger Zone</h2>
        <p className="vf-sub">
          Clear Data erases everything stored on this device — shop profile, catalog, stock, sales,
          returns, expenses, PIN, receipt counter and cloud configuration — and returns the app to
          the setup wizard. Data already synced to the cloud and other devices is not affected.
        </p>
        {sync.email && (
          <div className="p-3 bg-amber-50 text-amber-800 rounded-lg text-sm border border-amber-200">
            Sign out of the Cloud Connection above before clearing data on this device.
          </div>
        )}
        <button
          type="button"
          disabled={Boolean(sync.email)}
          onClick={() => {
            setResetError('');
            setResetConfirm('');
            setResetModalOpen(true);
          }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-3 font-semibold text-white shadow transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear Data
        </button>
      </section>

      {/* Clear Data Confirmation Modal */}
      {resetModalOpen && (
        <div className="vf-modal">
          <div className="vf-modal-card max-w-lg space-y-4 p-6">
            <h3 className="text-xl font-bold text-slate-900">Clear all data?</h3>
            <p className="vf-sub">
              This permanently deletes every shop, product, stock movement, sale, return and
              expense on this device, along with the PIN and settings. The app will restart at the
              setup wizard. This cannot be undone.
            </p>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              Export a backup first if you may need this data later.
            </div>
            <div>
              <label htmlFor="clear-data-confirm" className="vf-label">
                Type DELETE to confirm
              </label>
              <input
                id="clear-data-confirm"
                type="text"
                autoComplete="off"
                value={resetConfirm}
                disabled={resetting}
                onChange={(e) => {
                  setResetConfirm(e.target.value);
                  setResetError('');
                }}
                className="vf-input"
                placeholder="DELETE"
              />
            </div>
            {resetError && (
              <div role="alert" className="p-3 bg-rose-50 text-rose-700 rounded-xl text-sm border border-rose-200">
                {resetError}
              </div>
            )}
            <div className="flex justify-end gap-3 pt-3 border-t">
              <button
                type="button"
                disabled={resetting}
                onClick={() => {
                  setResetModalOpen(false);
                  setResetConfirm('');
                  setResetError('');
                }}
                className="vf-btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resetting || resetConfirm.trim().toUpperCase() !== 'DELETE'}
                onClick={() => void handleClearData()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 font-semibold text-white shadow transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resetting ? 'Clearing...' : 'Clear Data'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Confirmation Modal */}
      {restoreModalOpen && pendingBackupData && (
        <div className="vf-modal">
          <div className="vf-modal-card max-w-lg space-y-4 p-6">
            <h3 className="text-xl font-bold text-slate-900">Confirm Backup Restore</h3>
            <p className="vf-sub">
              You are about to restore backup from <span className="font-mono">{new Date(pendingBackupData.exported_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</span> (App version: {pendingBackupData.app_version}).
            </p>
            <div className="p-3 bg-amber-50 text-amber-800 rounded-lg text-sm border border-amber-200">
              ⚠️ Warning: Restoring this backup will replace all current local synced data (products, sales, stock, expenses) with the backup contents. Local device identity and PIN are preserved.
            </div>
            <div className="space-y-1 text-xs text-slate-500">
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
                className="vf-btn-ghost"
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
                    await sync.restore(pendingBackupData);
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
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 font-semibold text-white shadow transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {restoring ? 'Restoring...' : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
