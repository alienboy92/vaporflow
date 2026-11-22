/**
 * OTG keyboard-wedge preference.
 *
 * A USB-over-OTG scanner types into the focused field like a keyboard and
 * finishes with Enter. In wedge mode the field sets `inputMode="none"` so
 * taps never summon the soft keyboard (the physical scanner still works),
 * while manual mode keeps normal text entry. The preference persists across
 * screens via localStorage.
 */
import { useCallback, useState } from 'react';

const WEDGE_KEY = 'vaporflow_wedge_mode';

export function readWedgePref(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(WEDGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeWedgePref(enabled: boolean): void {
  try {
    localStorage.setItem(WEDGE_KEY, enabled ? '1' : '0');
  } catch {
    // storage unavailable (private mode) — keep the session-only value
  }
}

export function useWedgeMode(): [boolean, () => void] {
  const [wedge, setWedge] = useState<boolean>(readWedgePref);
  const toggle = useCallback(() => {
    setWedge((prev) => {
      const next = !prev;
      writeWedgePref(next);
      return next;
    });
  }, []);
  return [wedge, toggle];
}
