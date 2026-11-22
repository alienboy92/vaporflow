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
    <div className="vf-modal">
      <div className="vf-modal-card max-w-sm space-y-4 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-2xl text-emerald-400">
          🔒
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">VaporFlow Locked</h2>
          <p className="vf-sub mt-1">Enter your PIN to unlock the app.</p>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-4">
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            className="vf-input text-center text-2xl tracking-widest"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            aria-label="PIN"
          />

          <button
            type="submit"
            disabled={verifying || !pin}
            className="vf-btn-primary w-full"
          >
            {verifying ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}
