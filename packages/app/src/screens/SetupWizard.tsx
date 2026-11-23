import React, { useRef, useState } from 'react';
import { useDb } from '../context/DbProvider';
import { useCloudSync } from '../context/CloudSyncProvider';
import { ShopRepo } from '@vaporflow/core';
import { resizeLogo } from '../utils/logo';
import { globalErrorLogger } from '../utils/logger';
import { uuidv7 } from '@vaporflow/core';
import { Icon } from '../components/Icon';

interface SetupWizardProps {
  pendingJoin?: boolean;
  onComplete: () => void;
}

type Mode = 'create' | 'join';

export function SetupWizard({ onComplete, pendingJoin }: SetupWizardProps) {
  const sync = useCloudSync();
  const [mode, setMode] = useState<Mode>(pendingJoin ? 'join' : 'create');

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="brand-mark">
            <Icon name="zap" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">First-Run Setup</h1>
            <p className="vf-sub">Configure your local shop and device.</p>
          </div>
        </div>

        <div className="mb-6 flex gap-2" role="tablist" aria-label="Setup mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            disabled={pendingJoin || sync.busy}
            onClick={() => setMode('create')}
            className={`min-h-11 flex-1 rounded-xl border p-2.5 text-sm font-semibold ${
              mode === 'create'
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            New shop
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'join'}
            onClick={() => setMode('join')}
            className={`min-h-11 flex-1 rounded-xl border p-2.5 text-sm font-semibold ${
              mode === 'join'
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Join an existing shop
          </button>
        </div>

        {mode === 'create' ? (
          <CreateShopForm onComplete={onComplete} />
        ) : (
          <JoinShopForm sync={sync} onComplete={onComplete} />
        )}
      </div>
    </main>
  );
}

function CreateShopForm({ onComplete }: { onComplete: () => void }) {
  const db = useDb();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [deviceCode, setDeviceCode] = useState('PC1');
  const [deviceName, setDeviceName] = useState('Main PC');
  const [logoBase64, setLogoBase64] = useState<string | null>(null);
  const [logoError, setLogoError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLogoError('');
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeLogo(file);
      setLogoBase64(resized);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Invalid logo file');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const trimmedName = name.trim();
    const trimmedCode = deviceCode.trim().toUpperCase();

    if (!trimmedName) {
      setError('Shop name is required');
      return;
    }
    if (!/^[A-Z0-9]{2,4}$/.test(trimmedCode)) {
      setError('Device code must be 2 to 4 uppercase letters or numbers (e.g. PC1, PH1)');
      return;
    }

    setSubmitting(true);
    try {
      const shopId = uuidv7();
      const deviceId = uuidv7();
      const now = new Date().toISOString();

      const shopRepo = new ShopRepo(db);
      await shopRepo.saveFirstRun(
        {
          id: shopId,
          shop_id: shopId,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          device_id: deviceId,
          dirty: 1,
          server_updated_at: null,
          name: trimmedName,
          address: address.trim() || null,
          phone: phone.trim() || null,
          logo_base64: logoBase64,
          show_logo_on_receipt: logoBase64 ? 1 : 0,
          currency_code: 'PKR',
          currency_decimals: 0,
          receipt_footer: 'Thank you for shopping with us',
          default_low_stock_threshold: 3,
        },
        {
          id: deviceId,
          shop_id: shopId,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          device_id: deviceId,
          dirty: 1,
          server_updated_at: null,
          name: deviceName.trim() || trimmedCode,
          code: trimmedCode,
          last_seen_at: now,
        },
      );
      onComplete();
    } catch (err) {
      globalErrorLogger.log(err);
      setError(err instanceof Error ? err.message : 'Failed to save setup');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700">
          {error}
        </div>
      )}

      <div>
        <label className="vf-label">Shop Name *</label>
        <input
          type="text"
          required
          className="vf-input text-base"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Vapor Central"
        />
      </div>

      <div>
        <label className="vf-label">Address</label>
        <input
          type="text"
          className="vf-input text-base"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. Shop 4, Plaza Market"
        />
      </div>

      <div>
        <label className="vf-label">Phone</label>
        <input
          type="text"
          className="vf-input text-base"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. 03001234567"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="vf-label">Device Code *</label>
          <input
            type="text"
            required
            maxLength={4}
            className="vf-input text-base uppercase"
            value={deviceCode}
            onChange={(e) => setDeviceCode(e.target.value.toUpperCase())}
            placeholder="PC1 or PH1"
          />
          <span className="vf-sub mt-1 block">2 to 4 uppercase chars (e.g. PC1)</span>
        </div>
        <div>
          <label className="vf-label">Device Name</label>
          <input
            type="text"
            className="vf-input text-base"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="e.g. Counter PC"
          />
        </div>
      </div>

      <div>
        <label className="vf-label">Shop Logo (Optional)</label>
        <input
          type="file"
          accept="image/*"
          className="vf-file-input"
          onChange={handleLogoChange}
        />
        {logoError && <p className="mt-1 text-sm text-rose-600">{logoError}</p>}
        {logoBase64 && (
          <div className="mt-2 flex items-center gap-3">
            <img src={logoBase64} alt="Logo preview" className="h-12 w-12 rounded-lg border border-slate-200 object-contain" />
            <span className="text-sm text-emerald-600">Logo loaded (resized to max 256px)</span>
            <button
              type="button"
              className="text-sm text-rose-600 underline"
              onClick={() => setLogoBase64(null)}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      <div className="pt-4">
        <button
          type="submit"
          disabled={submitting}
          className="vf-btn-primary w-full"
        >
          {submitting ? 'Setting up…' : 'Save & Start'}
        </button>
        <p className="vf-sub mt-3">
          You can connect this shop to the cloud later in Settings → Cloud Connection.
        </p>
      </div>
    </form>
  );
}

interface JoinShopFormProps {
  sync: ReturnType<typeof useCloudSync>;
}

function JoinShopForm({ sync, onComplete }: JoinShopFormProps & { onComplete: () => void }) {
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shopId, setShopId] = useState('');
  const [deviceName, setDeviceName] = useState('Counter Device');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [joinedCode, setJoinedCode] = useState<string | null>(null);
  // Synchronous double-submit guard: repeated clicks in the same tick must
  // not enqueue a second enrollment.
  const submittingRef = useRef(false);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setSubmitting(true);
    try {
      await sync.saveConfig(supabaseUrl, anonKey);
      if (!sync.email) {
        await sync.signIn(email.trim(), password);
      }
      const { deviceCode } = await sync.joinExistingShop(shopId, deviceName);
      setJoinedCode(deviceCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Joining the shop failed.');
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  if (joinedCode !== null) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status">
          <p className="font-medium text-emerald-800">Joined! Shop data downloaded to this device.</p>
        </div>
        <div>
          <span className="vf-label">This device&apos;s code</span>
          <span className="font-mono text-2xl font-bold tracking-widest text-emerald-700">{joinedCode}</span>
          <p className="vf-sub mt-1">
            The owner device will see this code in Settings → Cloud Connection → Devices.
          </p>
        </div>
        <button
          type="button"
          onClick={onComplete}
          className="vf-btn-primary w-full"
        >
          Start using VaporFlow
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleJoin} className="space-y-4">
      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700">
          {error}
        </div>
      )}

      <p className="vf-sub">
        This joins a shop created on another device. You need the owner&apos;s Supabase project
        credentials, your cloud account, and the Shop ID shown on the owner device.
      </p>

      <div>
        <label className="vf-label">Supabase Project URL *</label>
        <input
          type="url"
          required
          className="vf-input text-base"
          value={supabaseUrl}
          onChange={(e) => setSupabaseUrl(e.target.value)}
          placeholder="https://xxxx.supabase.co"
        />
      </div>

      <div>
        <label className="vf-label">Supabase Anon Key *</label>
        <input
          type="password"
          required
          className="vf-input text-base"
          value={anonKey}
          onChange={(e) => setAnonKey(e.target.value)}
          placeholder="Paste the anon (public) key"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="vf-label">Email *</label>
          <input
            type="email"
            required
            autoComplete="email"
            className="vf-input text-base"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="vf-label">Password *</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            className="vf-input text-base"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Cloud account password"
          />
        </div>
      </div>

      <div>
        <label className="vf-label">Shop ID *</label>
        <input
          type="text"
          required
          className="vf-input font-mono text-base"
          value={shopId}
          onChange={(e) => setShopId(e.target.value)}
          placeholder="UUID from the owner device's Settings"
        />
      </div>

      <div>
        <label className="vf-label">Device Name</label>
        <input
          type="text"
          className="vf-input text-base"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="e.g. Counter Phone"
        />
      </div>

      <div className="pt-4">
        <button
          type="submit"
          disabled={submitting || sync.busy}
          className="vf-btn-primary w-full"
        >
          {submitting || sync.busy ? 'Joining shop…' : 'Join Shop & Sync'}
        </button>
        <p className="vf-sub mt-3">
          Only use this on a device with no local shop yet. The full shop data is downloaded once.
        </p>
      </div>
    </form>
  );
}
