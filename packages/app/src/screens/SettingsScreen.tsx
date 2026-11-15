import React, { useEffect, useState, useCallback } from 'react';
import { useDb } from '../context/DbProvider';
import { ShopRepo, DeviceRepo, SettingsRepo, hashPin, verifyPin } from '@vaporflow/core';
import type { Shop, Device } from '@vaporflow/core';
import { resizeLogo } from '../utils/logo';
import { globalErrorLogger } from '../utils/logger';
import { DbCheck } from './DbCheck';

export function SettingsScreen() {
  const db = useDb();
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
      const storedHash = await settingsRepo.get('pin_hash');

      if (storedHash) {
        if (!currentPin) {
          setPinMessage('Enter current PIN to change or remove.');
          return;
        }
        const match = await verifyPin(currentPin, storedHash);
        if (!match) {
          setPinMessage('Incorrect current PIN.');
          return;
        }
      }

      if (newPin) {
        if (!/^\d{4,6}$/.test(newPin)) {
          setPinMessage('New PIN must be 4 to 6 digits.');
          return;
        }
        const hash = await hashPin(newPin);
        await settingsRepo.set('pin_hash', hash);
        setPinMessage('PIN updated successfully.');
      } else {
        await settingsRepo.set('pin_hash', '');
        setPinMessage('PIN removed successfully.');
      }
      setCurrentPin('');
      setNewPin('');
      void loadData();
    } catch (err) {
      globalErrorLogger.log(err);
      setPinMessage('Failed to update PIN.');
    }
  }

  async function handleIdleTimeoutChange(minutes: string) {
    try {
      const settingsRepo = new SettingsRepo(db);
      await settingsRepo.set('idle_lock_minutes', minutes);
      setSettings((prev) => ({ ...prev, idle_lock_minutes: minutes }));
    } catch (err) {
      globalErrorLogger.log(err);
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-600" role="status">Loading settings...</div>;
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
        <div role="status" className="p-4 bg-green-50 text-green-700 rounded border border-green-200">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Receipt Footer</label>
                <input
                  type="text"
                  className="w-full rounded border border-gray-300 p-3 min-h-11"
                  value={shop.receipt_footer}
                  onChange={(e) => setShop({ ...shop, receipt_footer: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Low Stock Threshold</label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded border border-gray-300 p-3 min-h-11"
                  value={shop.default_low_stock_threshold}
                  onChange={(e) => setShop({ ...shop, default_low_stock_threshold: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shop Logo</label>
                <input type="file" accept="image/*" onChange={handleLogoChange} className="text-sm text-gray-500" />
              </div>
              {shop.logo_base64 && (
                <div className="flex items-center gap-3">
                  <img src={shop.logo_base64} alt="Shop logo" className="h-12 w-12 object-contain border rounded" />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={shop.show_logo_on_receipt === 1}
                      onChange={(e) => setShop({ ...shop, show_logo_on_receipt: e.target.checked ? 1 : 0 })}
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
          <p>Version: 1.0.0 (Phase 3)</p>
          <p>Platform: Desktop / Android</p>
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-800">Error Log (Last 100)</h2>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const text = logs.map((l) => `[${l.timestamp}] ${l.message}\n${l.stack || ''}`).join('\n---\n');
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
                {log.stack && <div className="text-gray-500 text-[10px] whitespace-pre-wrap">{log.stack}</div>}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Development Diagnostics</h2>
        <DbCheck />
      </section>
    </div>
  );
}
