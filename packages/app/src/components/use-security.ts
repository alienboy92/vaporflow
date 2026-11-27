import { useEffect, useRef, useState } from 'react';
import { SettingsRepo } from '@bali-hub-pos/core';
import { useDb } from '../context/DbProvider';
import { IdleLock } from '../utils/idle-lock';

export function useSecurity() {
  const db = useDb();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [locked, setLocked] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [minutes, setMinutes] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const clock = useRef(new IdleLock());
  useEffect(() => {
    let active = true;
    let initial = true;
    let revision = 0;
    const load = async () => {
      const current = ++revision;
      try {
        const values = await new SettingsRepo(db).getAll();
        if (!active || current !== revision) return;
        const pinEnabled = Boolean(values.pin_hash);
        const timeout = Number(values.idle_lock_minutes || 0);
        if (!Number.isInteger(timeout) || timeout < 0) throw new Error('Invalid lock timeout');
        setEnabled(pinEnabled);
        setMinutes(timeout);
        if (initial) {
          setLocked(pinEnabled);
          clock.current.reset();
        } else if (!pinEnabled) setLocked(false);
        initial = false;
        setReady(true);
        setError(false);
      } catch {
        if (active && current === revision) {
          setError(true);
          setReady(false);
        }
      }
    };
    const changed = () => {
      void load();
    };
    changed();
    window.addEventListener('vaporflow-security-changed', changed);
    return () => {
      active = false;
      window.removeEventListener('vaporflow-security-changed', changed);
    };
  }, [db, attempt]);
  useEffect(() => {
    if (!ready || !enabled || locked) return;
    const activity = (event: Event) => {
      if (clock.current.activity(minutes)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setLocked(true);
      }
    };
    const check = () => {
      if (clock.current.expired(minutes)) setLocked(true);
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart'] as const;
    events.forEach((event) => window.addEventListener(event, activity, true));
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 1000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, activity, true));
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [ready, enabled, locked, minutes]);
  return {
    ready,
    error,
    locked,
    enabled,
    retry: () => setAttempt((value) => value + 1),
    lock: () => {
      if (enabled) setLocked(true);
    },
    unlock: () => {
      clock.current.reset();
      setLocked(false);
    },
  };
}
