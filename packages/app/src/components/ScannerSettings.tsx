import { useEffect, useRef, useState } from 'react';
import { readDelimiters, saveDelimiters, stripScan } from '../utils/scanner-capture';

export function ScannerSettings() {
  const [value, setValue] = useState(readDelimiters);
  const [raw, setRaw] = useState('');
  const test = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const observe = (event: KeyboardEvent) => {
      if (document.activeElement !== test.current) return;
      const key = event.key;
      if (key === 'F13') setRaw('');
      else if (key.length === 1 || key === 'Enter')
        setRaw((old) => (old + (key === 'Enter' ? '\r' : key)).slice(-8192));
    };
    // The capture handler publishes every key while the diagnostic field has focus.
    const rawKey = (event: Event) => observe((event as CustomEvent<KeyboardEvent>).detail);
    window.addEventListener('vf-diagnostic-key', rawKey);
    return () => {
      window.removeEventListener('vf-diagnostic-key', rawKey);
    };
  }, []);
  return (
    <section className="vf-card space-y-3 p-5">
      <h2 className="vf-title">Barcode scanner</h2>
      {(['prefix', 'suffix'] as const).map((field) => (
        <label className="block" key={field}>
          Strip {field}
          <input
            className="vf-input"
            maxLength={64}
            value={value[field]}
            onChange={(event) => {
              const next = { ...value, [field]: event.target.value };
              saveDelimiters(next);
              setValue(next);
            }}
          />
        </label>
      ))}
      <label className="block">
        Test scan
        <input
          ref={test}
          data-scan-diagnostic="true"
          className="vf-input"
          readOnly
          value={JSON.stringify(raw)}
        />
      </label>
      <p>Decoded value · {stripScan(raw.replace(/\r$/, ''), value)}</p>
      <button
        className="vf-btn-ghost"
        onClick={() => {
          setRaw('');
          test.current?.focus();
        }}
      >
        Clear test
      </button>
    </section>
  );
}
