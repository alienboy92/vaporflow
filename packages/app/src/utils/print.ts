/**
 * Hidden-iframe printing: renders the given body HTML + CSS in a detached
 * document and invokes the browser print dialog on it, so window.print()
 * prints exactly the receipt/label content instead of the whole app page.
 */

function htmlDocument(bodyHtml: string, css: string, title: string): string {
  const escapedTitle = title
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapedTitle}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`;
}

/**
 * Opens the print dialog for the given content. The iframe is removed after
 * printing (afterprint) or after a fallback timeout, whichever comes first.
 */
export function printHtml(bodyHtml: string, css: string, title: string): void {
  if (typeof document === 'undefined') {
    throw new Error('Printing requires a browser DOM');
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
      return;
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
  doc.write(htmlDocument(bodyHtml, css, title));
  doc.close();

  const waitForResources = () => {
    const images = Array.from(doc.images);
    if (images.every((img) => img.complete)) {
      printNow();
    } else {
      window.setTimeout(waitForResources, 50);
    }
  };
  window.setTimeout(waitForResources, 0);
}
