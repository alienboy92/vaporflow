export interface ErrorLogEntry {
  timestamp: string;
  message: string;
  stack?: string;
}

class ErrorLogger {
  private logs: ErrorLogEntry[] = [];
  private maxLogs = 100;

  log(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const sanitizedMessage = message
      .replace(/pin[=:]\s*\d+/gi, 'pin=***')
      .replace(/password[=:]\s*\S+/gi, 'password=***');

    this.logs.unshift({
      timestamp: new Date().toISOString(),
      message: sanitizedMessage,
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
