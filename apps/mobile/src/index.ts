import { Capacitor } from '@capacitor/core';
import { CapacitorDbAdapter } from './capacitor-adapter.js';
import { capacitorShare } from './share.js';
import { capacitorScanner } from './scanner.js';
import { capacitorPrinter } from './printer.js';
export { CapacitorDbAdapter } from './capacitor-adapter.js';

let primary: CapacitorDbAdapter | undefined;

export async function createMobileDatabase() {
  if (Capacitor.getPlatform() !== 'android')
    throw new Error('Run this app in Electron or on Android. Browser SQLite is not configured.');
  primary ??= new CapacitorDbAdapter('vaporflow');
  await primary.migrate();
  return { db: primary, share: capacitorShare, scanner: capacitorScanner, printer: capacitorPrinter };
}
