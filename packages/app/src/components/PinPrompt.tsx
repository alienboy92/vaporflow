import React, { useEffect, useState } from 'react';
import { useDb } from '../context/DbProvider';
import { SettingsRepo, verifyPin } from '@bali-hub-pos/core';
import { globalErrorLogger } from '../utils/logger';
import { registerBackHandler } from '../utils/back-nav';

interface PinPromptProps {
  title: string;
  description: string;
  onSuccess: () => void;
  onCancel?: () => void;
}

/**
 * Asks for the configured PIN before a protected action. Callers only render
 * this when a PIN is configured; a PIN removed while the prompt is open lets
 * the action continue rather than trapping the user.
 */
export function PinPrompt({ title, description, onSuccess, onCancel }: PinPromptProps) {
  const db = useDb();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!onCancel) return;
    return registerBackHandler(() => {
      onCancel();
      return true;
    });
  }, [onCancel]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setVerifying(true);
    try {
      const storedHash = await new SettingsRepo(db).get('pin_hash');
      if (!storedHash || (await verifyPin(pin, storedHash))) {
        onSuccess();
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
    <div className="vf-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="vf-modal-card max-w-sm space-y-4 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-2xl text-emerald-400">
          🔒
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          <p className="vf-sub mt-1">{description}</p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div className="flex gap-2">
            {onCancel && (
              <button type="button" onClick={onCancel} className="vf-btn-ghost flex-1">
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={verifying || !pin}
              className="vf-btn-primary flex-1"
            >
              {verifying ? 'Checking…' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
