export interface PrinterPlugin {
  /** Prints a complete HTML document through the Android system print service. */
  printHtml(options: { html: string; documentName?: string }): Promise<void>;
}

export declare const Printer: PrinterPlugin;
