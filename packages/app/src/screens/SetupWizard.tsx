import React, { useRef, useState } from 'react';
import { useDb } from '../context/DbProvider';
import { useCloudSync } from '../context/CloudSyncProvider';
import { ShopRepo } from '@vaporflow/core';
import { resizeLogo } from '../utils/logo';
import { globalErrorLogger } from '../utils/logger';
import { uuidv7 } from '@vaporflow/core';

interface SetupWizardProps {
  onComplete: () => void;
}

type Mode = 'create' | 'join';

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const sync = useCloudSync();
  const [mode, setMode] = useState<Mode>('create');

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="max-w-xl w-full bg-white rounded-xl shadow-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">VaporFlow — First-Run Setup</h1>
        <p className="text-gray-600 mb-6">Configure your local shop and device.</p>

        <div className="flex gap-2 mb-6" role="tablist" aria-label="Setup mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            onClick={() => setMode('create')}
            className={`flex-1 rounded p-2.5 min-h-11 font-medium border ${
              mode === 'create'
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            New shop
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'join'}
            onClick={() => setMode('join')}
            className={`flex-1 rounded p-2.5 min-h-11 font-medium border ${
              mode === 'join'
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
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
        <div role="alert" className="mb-4 p-3 bg-red-50 text-red-700 rounded border border-red-200">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Shop Name *</label>
        <input
          type="text"
          required
          className="w-full rounded border border-gray-300 p-3 min-h-11 text-base focus:ring-2 focus:ring-blue-500"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Vapor Central"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
        <input
          type="text"
          className="w-full rounded border border-gray-300 p-3 min-h-11 text-base focus:ring-2 focus:ring-blue-500"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. Shop 4, Plaza Market"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
        <input
          type="text"
          className="w-full rounded border border-gray-300 p-3 min-h-11 text-base focus:ring-2 focus:ring-blue-500"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. 03001234567"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Device Code *</label>
          <input
            type="text"
            required
            maxLength={4}
            className="w-full rounded border border-gray-300 p-3 min-h-11 text-base uppercase focus:ring-2 focus:ring-blue-500"
            value={deviceCode}
            onChange={(e) => setDeviceCode(e.target.value.toUpperCase())}
            placeholder="PC1 or PH1"
          />
          <span className="text-xs text-gray-500 mt-1 block">2 to 4 uppercase chars (e.g. PC1)</span>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Device Name</label>
          <input
            type="text"
            className="w-full rounded border border-gray-300 p-3 min-h-11 text-base focus:ring-2 focus:ring-blue-500"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="e.g. Counter PC"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Shop Logo (Optional)</label>
        <input
          type="file"
          accept="image/*"
          className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 min-h-11"
          onChange={handleLogoChange}
        />
        {logoError && <p className="text-sm text-red-600 mt-1">{logoError}</p>}
        {logoBase64 && (
          <div className="mt-2 flex items-center gap-3">
            <img src={logoBase64} alt="Logo preview" className="h-12 w-12 object-contain border rounded" />
            <span className="text-sm text-green-600">Logo loaded (resized to max 256px)</span>
            <button
              type="button"
              className="text-sm text-red-600 underline"
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
          className="w-full rounded bg-blue-700 text-white p-3 min-h-11 font-medium hover:bg-blue-800 disabled:opacity-50"
        >
          {submitting ? 'Setting up...' : 'Save & Start'}
        </button>
        <p className="text-xs text-gray-500 mt-3">
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
        <div className="p-4 bg-green-50 border border-green-200 rounded" role="status">
          <p className="font-medium text-green-800">Joined! Shop data downloaded to this device.</p>
        </div>
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-1">This device&apos;s code</span>
          <span className="text-2xl font-mono font-bold tracking-widest text-blue-800">{joinedCode}</span>
          <p className="text-xs text-gray-500 mt-1">
            The owner device will see this code in Settings → Cloud Connection → Devices.
          </p>        </div>
        <button
          type="button"
          onClick={onComplete}
          className="w-full rounded bg-blue-700 text-white p-3 min-h-11 font-medium hover:bg-blue-800"
        >
          Start using VaporFlow
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleJoin} className="space-y-4">
      {error && (
        <div role="alert" className="mb-4 p-3 bg-red-50 text-red-700 rounded border border-red-200">
          {error}
        </div>
      )}

      <p className="text-sm text-gray-600">
        This joins a shop created on another device. You need the owner&apos;s Supabase project
        credentials, your cloud account, and the Shop ID shown on the owner device.
      </p>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Supabase Project URL *</label>
        <input
          type="url"
          required
          className="w-full rounded border border-gray-300 p-3 min-h-11 text-base focus:ring-2 focus:ring-blue-500"
          value={supabaseUrl}
          onChange={(e) => setSupabaseUrl(e.target.value)}
          placeholder="https://xxxx.supabase.co"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Supabase Anon Key *</label>
        <input
          type="password"
          required
          className="w-full rounded border border-gray-300 p-3 min-h-11 text-base focus:ring-2 focus:ring-blue-500"
          value={anonKey}
          onChange={(e) => setAnonKey(e.target.value)}
          placeholder="Paste the anon (public) key"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
          <input
            type="email"
            required
            autoComplete="email"
            className="w-full rounded border border-gray-300 p-3 min-h-11 text-base focus:ring-2 focus:ring-blue-500"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded border border-gray-300 p-3 min-h-11 text-base focus:ring-2 focus:ring-blue-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Cloud account password"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Shop ID *</label>
        <input
          type="text"
          required
          className="w-full rounded border border-gray-300 p-3 min-h-11 text-base font-mono focus:ring-2 focus:ring-blue-500"
          value={shopId}
          onChange={(e) => setShopId(e.target.value)}
          placeholder="UUID from the owner device's Settings"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Device Name</label>
        <input
          type="text"
          className="w-full rounded border border-gray-300 p-3 min-h-11 text-base focus:ring-2 focus:ring-blue-500"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="e.g. Counter Phone"
        />
      </div>

      <div className="pt-4">
        <button
          type="submit"
          disabled={submitting || sync.busy}
          className="w-full rounded bg-blue-700 text-white p-3 min-h-11 font-medium hover:bg-blue-800 disabled:opacity-50"
        >
          {submitting || sync.busy ? 'Joining shop...' : 'Join Shop & Sync'}
        </button>
        <p className="text-xs text-gray-500 mt-3">
          Only use this on a device with no local shop yet. The full shop data is downloaded once.
        </p>
      </div>
    </form>
  );
}
