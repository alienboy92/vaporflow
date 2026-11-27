import { Capacitor } from '@capacitor/core';
import { isAllowedExternalUrl, type AppAdapter } from '@bali-hub-pos/core';

/**
 * Opens allow-listed links in the system browser. Capacitor's Android WebView
 * handles the `_system` target without needing an extra native plugin.
 */
export const capacitorApp: AppAdapter = {
  async openExternal(url) {
    if (!isAllowedExternalUrl(url)) throw new Error('Blocked external URL');
    if (Capacitor.getPlatform() === 'android') {
      window.open(url, '_system');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  },
};
