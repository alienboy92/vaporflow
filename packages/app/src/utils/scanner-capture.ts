/** An explicit F13 prefix lets us consume the first character before it reaches a field. */
export function framedScanner(receive: (barcode: string) => void) {
  let buffer: string | null = null;
  let invalid = false;
  return (key: string): boolean => {
    if (key === 'F13') {
      buffer = '';
      invalid = false;
      return true;
    }
    if (buffer === null) return false;
    if (key === 'Enter' || key === 'Escape') {
      const completed = buffer;
      buffer = null;
      if (key === 'Enter' && completed && !invalid) receive(completed);
    } else if (key.length === 1 && buffer.length < 8192) {
      buffer += key;
    } else if (key !== 'Shift') {
      invalid = true;
    }
    return true;
  };
}

export function installScannerCapture() {
  const consume = framedScanner(code => window.dispatchEvent(new CustomEvent('vf-barcode', { detail: code })));
  const held = new Set<string>();
  window.addEventListener('keydown', event => {
    if (!consume(event.key)) return;
    held.add(event.code);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('keyup', event => {
    if (!held.delete(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('blur', () => { consume('Escape'); held.clear(); });
}
