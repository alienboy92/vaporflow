import { registerPlugin } from '@capacitor/core';

/**
 * Android system printing. The native side hands a complete HTML document to
 * Android's PrintManager, so the system print dialog opens with the receipt or
 * label sheet ready to print or save as PDF.
 */
export const Printer = registerPlugin('Printer');
