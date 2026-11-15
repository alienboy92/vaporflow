/** Android file sharing via Capacitor Filesystem + Share plugins. */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ShareAdapter } from '@vaporflow/core';

/** Base64 for arbitrary bytes without Node Buffer (chunked to avoid arg limits). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]!);
  }
  return btoa(binary);
}

/** Writes the file to the app cache and opens the Android share sheet on it. */
export const capacitorShare: ShareAdapter = {
  async shareFile(name, data, mime) {
    const isText = typeof data === 'string';
    await Filesystem.writeFile({
      path: name,
      data: isText ? data : bytesToBase64(data),
      directory: Directory.Cache,
      ...(isText ? { encoding: Encoding.UTF8 } : {}),
    });
    const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
    await Share.share({
      title: name,
      url: uri,
      // mime selects the receiving apps on some Android versions via the dialog.
      dialogTitle: mime === 'application/pdf' ? 'Share receipt' : 'Share file',
    });
  },
};
