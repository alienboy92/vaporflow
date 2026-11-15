export interface ErrorLogEntry {
  timestamp: string;
  message: string;
  stack?: string;
}

export class ErrorLogger {
  private logs: ErrorLogEntry[] = [];
  private maxLogs = 100;

  log(error: unknown) {
    // Raw exception messages (including validation errors) may contain entire payloads.
    // Retain only source locations, never the message or the first stack line.
    const stack =
      error instanceof Error
        ? error.stack
            ?.split('\n')
            .slice(1)
            .flatMap((line) => {
              const match = line.match(/\/([a-zA-Z0-9_.-]+\.(?:js|tsx?|mjs)):(\d+):(\d+)/);
              return match ? [`${match[1]}:${match[2]}:${match[3]}`] : [];
            })
            .slice(0, 10)
            .join('\n')
        : undefined;

    this.logs.unshift({
      timestamp: new Date().toISOString(),
      message:
        'Application operation failed. Retry the operation; source locations follow when available.',
      stack,
    });
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
  }

  getLogs(): ErrorLogEntry[] {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
  }
}

export const globalErrorLogger = new ErrorLogger();
