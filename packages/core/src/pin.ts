import type { SettingsRepo } from './repositories/settings.js';

export async function updatePin(
  settings: SettingsRepo,
  currentPin: string,
  newPin: string,
): Promise<void> {
  const stored = await settings.get('pin_hash');
  if (stored && !(await verifyPin(currentPin, stored))) throw new Error('Incorrect current PIN');
  await settings.set('pin_hash', newPin ? await hashPin(newPin) : '');
}

export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must be 4 to 6 digits');
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + 'vaporflow-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const computed = await hashPin(pin);
  return computed === storedHash;
}
