/**
 * Browser printing. A hidden iframe is given a complete HTML document and its
 * print dialog is invoked, so only the receipt/label content is printed instead
 * of the whole app page. Android uses the native Printer plugin instead; this
 * module remains the desktop and fallback implementation.
 */

/** Wraps body HTML + CSS in a complete, self-contained document. */
export function htmlDocument(bodyHtml: string, css: string, title: string): string {
  const escapedTitle = title
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapedTitle}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`;
}

/**
 * Opens the browser print dialog for a complete HTML document. The iframe is
 * removed after printing (afterprint) or after a fallback timeout.
 */
export async function printDocument(html: string, title: string): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('Printing requires a browser window');
  }
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', `Print: ${title}`);
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden',
  } satisfies Partial<CSSStyleDeclaration>);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    iframe.remove();
  };

  const printNow = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      throw new Error('Print window unavailable');
    }
    win.addEventListener('afterprint', cleanup);
    // Fallback: some platforms never fire afterprint for the dialog.
    window.setTimeout(cleanup, 60000);
    try {
      win.focus();
      win.print();
    } catch (error) {
      cleanup();
      throw error;
    }
  };

  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    throw new Error('Could not create a print document');
  }
  doc.open();
  doc.write(html);
  doc.close();

  try {
    await Promise.all(Array.from(doc.images, (image) => image.decode()));
    printNow();
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Convenience wrapper for body HTML + CSS. */
export function printHtml(bodyHtml: string, css: string, title: string): Promise<void> {
  return printDocument(htmlDocument(bodyHtml, css, title), title);
}
