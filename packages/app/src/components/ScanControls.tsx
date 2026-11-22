/**
 * Shared barcode-input controls: the camera scan button wired to
 * the platform ScannerAdapter, and the OTG wedge-mode toggle. Wedge mode
 * switches barcode inputs to `inputMode="none"` so the soft keyboard never
 * pops up while a physical scanner types into the focused field.
 */
import React, { useCallback } from 'react';
import { Icon } from './Icon';
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
      aria-label="Scan with camera"
      className="shrink-0 rounded-lg inline-flex items-center justify-center bg-emerald-600 text-white min-w-11 min-h-11 hover:bg-emerald-700 disabled:opacity-50"
    >
      {scanning ? '…' : <Icon name="camera" />}
    </button>
  );
}

interface WedgeToggleProps {
  /** Reflects and persists the wedge preference; inputs read the value for inputMode. */
  wedge: boolean;
  onToggle: () => void;
  compact?: boolean;
}

export function WedgeToggle({ wedge, onToggle, compact }: WedgeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Scanner wedge mode"
      aria-pressed={wedge}
      title={
        wedge
          ? 'Scanner wedge mode is ON: the soft keyboard is suppressed so a USB/OTG scanner can type into this field. Tap for manual entry.'
          : 'Manual entry. Tap to switch to scanner wedge mode (suppresses the soft keyboard for USB/OTG scanners).'
      }
      className={`min-h-11 shrink-0 rounded-xl border px-3 py-3 text-xs font-medium ${
        wedge
          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
      }`}
    >
      {compact ? <Icon name="keyboard" /> : wedge ? 'Scanner' : 'Manual'}
    </button>
  );
}

export { useWedgeMode };
