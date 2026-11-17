/**
 * Shared barcode-input controls (Phase 9): the camera scan button wired to
 * the platform ScannerAdapter, and the OTG wedge-mode toggle. Wedge mode
 * switches barcode inputs to `inputMode="none"` so the soft keyboard never
 * pops up while a physical scanner types into the focused field.
 */
import React, { useCallback } from 'react';
import { usePlatform } from '../context/DbProvider';
import { useWedgeMode } from '../utils/wedge';

interface CameraScanButtonProps {
  /** Receives the scanned barcode; not called on user cancellation (null). */
  onScan: (code: string) => void;
  /** Receives a human-readable message when camera scanning is unavailable. */
  onError?: (message: string) => void;
  disabled?: boolean;
}

export function CameraScanButton({ onScan, onError, disabled }: CameraScanButtonProps) {
  const platform = usePlatform();
  const [scanning, setScanning] = React.useState(false);

  const handleClick = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const code = await platform.scanner.scanWithCamera();
      if (code !== null) onScan(code.trim());
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Camera scanning failed.');
    } finally {
      setScanning(false);
    }
  }, [platform, onScan, onError, scanning]);

  return (
    <button
      type="button"
      disabled={disabled || scanning}
      onClick={() => void handleClick()}
      title="Scan with camera"
      className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-3 min-h-11 text-base font-medium hover:bg-gray-100 disabled:opacity-50"
    >
      {scanning ? '…' : '📷'}
    </button>
  );
}

interface WedgeToggleProps {
  /** Reflects and persists the wedge preference; inputs read the value for inputMode. */
  wedge: boolean;
  onToggle: () => void;
}

export function WedgeToggle({ wedge, onToggle }: WedgeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={wedge}
      title={
        wedge
          ? 'Scanner wedge mode is ON: the soft keyboard is suppressed so a USB/OTG scanner can type into this field. Tap for manual entry.'
          : 'Manual entry. Tap to switch to scanner wedge mode (suppresses the soft keyboard for USB/OTG scanners).'
      }
      className={`shrink-0 rounded-lg border px-3 py-3 min-h-11 text-xs font-medium ${
        wedge
          ? 'border-blue-600 bg-blue-50 text-blue-700'
          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
      }`}
    >
      {wedge ? '🔌 Scanner' : '⌨ Manual'}
    </button>
  );
}

export { useWedgeMode };
