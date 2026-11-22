import { Capacitor } from '@capacitor/core';
import { Printer } from '@vaporflow/capacitor-printer';
import type { PrinterAdapter } from '@vaporflow/core';

/**
 * Native Android printing through the local "Printer" Capacitor plugin. The
 * plugin hands a complete HTML document to Android's PrintManager, so the
 * system print dialog opens with the receipt or label sheet ready to print or
 * save as PDF.
 */
async function print(html: string, documentName: string): Promise<void> {
  if (!Capacitor.isPluginAvailable('Printer')) {
    throw new Error('Printing is not available in this build. Install the latest VaporFlow app.');
  }
  await Printer.printHtml({ html, documentName });
}

export const capacitorPrinter: PrinterAdapter = {
  printReceipt: (html) => print(html, 'Receipt'),
  printLabels: (html) => print(html, 'Labels'),
};
