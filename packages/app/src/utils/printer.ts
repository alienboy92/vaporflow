import type { PrinterAdapter } from '@vaporflow/core';
import { printDocument } from './print';

/** Desktop/web printer: opens the browser print dialog on the given document. */
export const browserPrinter: PrinterAdapter = {
  async printReceipt(html: string): Promise<void> {
    await printDocument(html, 'Receipt');
  },
  async printLabels(html: string): Promise<void> {
    await printDocument(html, 'Labels');
  },
};
