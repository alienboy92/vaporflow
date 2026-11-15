import React, { useState } from 'react';
import { useDb } from '../context/DbProvider';
import { ShopRepo } from '@vaporflow/core';
import { resizeLogo } from '../utils/logo';
import { globalErrorLogger } from '../utils/logger';
import { uuidv7 } from '@vaporflow/core';

interface SetupWizardProps {
  onComplete: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
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
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="max-w-xl w-full bg-white rounded-xl shadow-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">VaporFlow — First-Run Setup</h1>
        <p className="text-gray-600 mb-6">Configure your local shop and device.</p>

        {error && (
          <div role="alert" className="mb-4 p-3 bg-red-50 text-red-700 rounded border border-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div className="pt-4 flex flex-col gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded bg-blue-700 text-white p-3 min-h-11 font-medium hover:bg-blue-800 disabled:opacity-50"
            >
              {submitting ? 'Setting up...' : 'Save & Start'}
            </button>

            <div className="border-t pt-4 mt-2">
              <button
                type="button"
                disabled
                className="w-full rounded border border-gray-300 bg-gray-50 text-gray-400 p-3 min-h-11 font-medium cursor-not-allowed"
                title="Existing shop cloud sign-in available in Phase 8B"
              >
                Sign in to existing shop (Phase 8B)
              </button>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
