import { z } from 'zod';
const config = z.object({ prefix: z.string().max(64), suffix: z.string().max(64) });
export type ScanDelimiters = z.infer<typeof config>;
const empty = { prefix: '', suffix: '' };
export function readDelimiters(): ScanDelimiters {
  try {
    return config.parse(JSON.parse(localStorage.getItem('vf-scan-delimiters') ?? 'null'));
  } catch {
    return empty;
  }
}
export function saveDelimiters(value: ScanDelimiters) {
  localStorage.setItem('vf-scan-delimiters', JSON.stringify(config.parse(value)));
}
export function stripScan(raw: string, { prefix, suffix }: ScanDelimiters) {
  const start = prefix && raw.startsWith(prefix) ? prefix.length : 0;
  const text = raw.slice(start);
  return suffix && text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
}

/** An explicit F13 prefix lets us consume the first character before it reaches a field. */
export function framedScanner(receive: (barcode: string) => void, preferences = () => empty) {
  let buffer: string | null = null;
  let invalid = false;
  let delimiters = empty;
  let suffixEndedAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function armTimeout() {
    timer = setTimeout(() => {
      const value = stripScan(buffer ?? '', delimiters);
      buffer = null;
      suffixEndedAt = performance.now();
      if (value && !invalid && !delimiters.suffix) receive(value);
    }, 200);
  }
  return (key: string): boolean => {
    clearTimeout(timer);
    if (key === 'F13') {
      delimiters = preferences();
      buffer = '';
      invalid = false;
      armTimeout();
      return true;
    }
    if (buffer === null) {
      const trailing = key === 'Enter' && performance.now() - suffixEndedAt < 100;
      suffixEndedAt = -Infinity;
      return trailing;
    }
    if (key === 'Enter' || key === 'Escape') {
      const completed = buffer;
      buffer = null;
      const value = stripScan(completed, delimiters);
      if (key === 'Enter' && value && !invalid) receive(value);
    } else if (key.length === 1 && buffer.length < 8192) {
      buffer += key;
      if (delimiters.suffix && buffer.endsWith(delimiters.suffix)) {
        const value = stripScan(buffer, delimiters);
        buffer = null;
        suffixEndedAt = performance.now();
        if (value && !invalid) receive(value);
      }
    } else if (key !== 'Shift') {
      invalid = true;
    }
    if (buffer !== null) armTimeout();
    return true;
  };
}

export function installScannerCapture() {
  const consume = framedScanner(
    (code) => window.dispatchEvent(new CustomEvent('vf-barcode', { detail: code })),
    readDelimiters,
  );
  const held = new Set<string>();
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.dataset.scanDiagnostic &&
        event.key !== 'Tab'
      ) {
        window.dispatchEvent(new CustomEvent('vf-diagnostic-key', { detail: event }));
        held.add(event.code);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!consume(event.key)) return;
      held.add(event.code);
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (!held.delete(event.code)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  window.addEventListener('blur', () => {
    consume('Escape');
    held.clear();
  });
}
