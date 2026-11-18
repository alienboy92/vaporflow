import React, { useState } from 'react';
import { useDb } from '../context/DbProvider';
import { SettingsRepo, verifyPin } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';

interface LockScreenProps {
  onUnlock: () => void;
}

export function LockScreen({ onUnlock }: LockScreenProps) {
  const db = useDb();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setVerifying(true);
    try {
      const settingsRepo = new SettingsRepo(db);
      const storedHash = await settingsRepo.get('pin_hash');
      if (!storedHash) {
        onUnlock();
        return;
      }
      const match = await verifyPin(pin, storedHash);
      if (match) {
        onUnlock();
      } else {
        setError('Incorrect PIN');
        setPin('');
      }
    } catch (err) {
      globalErrorLogger.log(err);
      setError('Error verifying PIN');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 z-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-center">
        <h2 className="text-xl font-bold text-gray-900 mb-2">VaporFlow Locked</h2>
        <p className="text-sm text-gray-600 mb-6">Enter your PIN to unlock the app.</p>

        {error && (
          <div role="alert" className="mb-4 p-2 bg-red-50 text-red-700 text-sm rounded border border-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-4">
          <input
            type="password"
            maxLength={6}
            autoFocus
            className="w-full text-center text-2xl tracking-widest rounded border border-gray-300 p-3 min-h-11 focus:ring-2 focus:ring-emerald-500"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
          />

          <button
            type="submit"
            disabled={verifying || !pin}
            className="w-full rounded bg-emerald-700 text-white p-3 min-h-11 font-medium hover:bg-emerald-800 disabled:opacity-50"
          >
            {verifying ? 'Checking...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}
