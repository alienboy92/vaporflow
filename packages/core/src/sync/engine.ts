import { VersionedSync } from './versioned.js';
import { DbAdapter } from '../db-adapter.js';
import { NetworkAdapter } from '../adapters/types.js';
import {
  SYNC_TABLES,
  SyncTransport,
  SyncState,
  SyncStatus,
  SyncProblem,
} from './types.js';

export interface SyncEngineOptions {
  clock?: () => Date;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

export class SyncEngine {
  readonly versioned?: VersionedSync;
  private isSyncing = false;
  private stopped = false;
  private idleWaiters: Array<() => void> = [];
  private queuedSync = false;
  private lastSuccessAt: string | null = null;
  private lastError: string | null = null;
  private consecutiveFailures = 0;
  private timer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private backoffTimer: NodeJS.Timeout | null = null;
  private queuedTimer: NodeJS.Timeout | null = null;
  private unsubscribeNetwork: (() => void) | null = null;
  protected clock: () => Date;
  private st: typeof setTimeout;
  private ct: typeof clearTimeout;
  private si: typeof setInterval;
  private ci: typeof clearInterval;

  constructor(
    protected db: DbAdapter,
    protected transport: SyncTransport,
    private network: NetworkAdapter,
    protected shopId: string,
    options?: SyncEngineOptions,
  ) {
    if (transport.writeVersioned && transport.manifest && transport.fetchRows) {
      this.versioned = new VersionedSync(db, transport, shopId, options?.clock);
    }
    this.clock = options?.clock ?? (() => new Date());
    this.st = options?.setTimeout ?? setTimeout;
    this.ct = options?.clearTimeout ?? clearTimeout;
    this.si = options?.setInterval ?? setInterval;
    this.ci = options?.clearInterval ?? clearInterval;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.unsubscribeNetwork = this.network.onChange((online) => {
      if (online) {
        this.trigger('network-reconnected');
      }
    });

    this.timer = this.si(() => {
      if (this.network.isOnline()) {
        this.trigger('interval-30s');
      }
    }, 30000);

    if (this.network.isOnline()) {
      await this.syncNow();
    }
  }

  async stopAndDrain(): Promise<void> {
    this.stop();
    if (this.isSyncing) await new Promise<void>(resolve => this.idleWaiters.push(resolve));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      this.ci(this.timer);
      this.timer = null;
    }
    if (this.debounceTimer) {
      this.ct(this.debounceTimer);
      this.debounceTimer = null;
    }
    // Cancel any pending backoff retry and queued-sync callback too:
    // a stopped engine must not keep syncing behind the caller's back.
    if (this.backoffTimer) {
      this.ct(this.backoffTimer);
      this.backoffTimer = null;
    }
    if (this.queuedTimer) {
      this.ct(this.queuedTimer);
      this.queuedTimer = null;
    }
    this.queuedSync = false;
    if (this.unsubscribeNetwork) {
      this.unsubscribeNetwork();
      this.unsubscribeNetwork = null;
    }
  }

  trigger(_reason = 'manual'): void {
    if (this.isSyncing) {
      this.queuedSync = true;
      return;
    }
    this.syncNow().catch(() => {
      // Fire-and-forget trigger: syncNow has already recorded lastError,
      // surfaced it through getStatus(), and scheduled the backoff retry.
    });
  }

  saleCompleted(): void {
    if (this.debounceTimer) {
      this.ct(this.debounceTimer);
    }
    this.debounceTimer = this.st(() => {
      this.trigger('post-sale');
    }, 2000);
  }

  async syncNow(): Promise<void> {
    if (this.stopped || !this.network.isOnline()) {
      return;
    }
    if (this.isSyncing) {
      this.queuedSync = true;
      return;
    }

    this.isSyncing = true;
    try {
      await this.runReplication();

      this.lastSuccessAt = this.clock().toISOString();
      this.lastError = null;
      this.consecutiveFailures = 0;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Failures must be visible even when no specific row is at fault
      // (network loss, server outage): without this a server outage would
      // render as plain `synced`.
      this.lastError = message;
      this.consecutiveFailures++;
      const backoffMs = Math.min(30000, 1000 * Math.pow(2, this.consecutiveFailures - 1));
      if (!this.stopped) this.backoffTimer = this.st(() => {
        this.backoffTimer = null;
        if (this.network.isOnline()) {
          this.trigger('retry-backoff');
        }
      }, backoffMs);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      this.isSyncing = false;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
      if (!this.stopped && this.queuedSync) {
        this.queuedSync = false;
        this.queuedTimer = this.st(() => {
          this.queuedTimer = null;
          void this.syncNow().catch(() => {
            // surfaced through lastError as above
          });
        }, 100);
      }
    }
  }

  async getPendingCount(): Promise<number> {
    let total = 0;
    for (const table of SYNC_TABLES) {
      try {
        const rows = await this.db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM ${table} WHERE shop_id = ? AND dirty = 1`,
          [this.shopId],
        );
        total += rows[0]?.count ?? 0;
      } catch {
        // Table might not exist yet
      }
    }
    return total;
  }

  async getStatus(): Promise<SyncState> {
    const online = this.network.isOnline();
    const pendingCount = await this.getPendingCount();

    const problems = await this.readProblems();
    let status: SyncStatus = 'synced';
    if (!online) {
      status = 'offline';
    } else if (problems.length > 0 || this.lastError !== null) {
      status = 'error';
    } else if (pendingCount > 0) {
      status = 'pending';
    }

    return {
      status,
      pendingCount,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      problems,
      isSyncing: this.isSyncing,
    };
  }

  protected async runReplication() {
    if (!this.versioned) throw new Error('Versioned cloud sync is required. Check for an app update.');
    await this.versioned.run();
  }
  protected async readProblems(): Promise<SyncProblem[]> {
    return this.versioned ? this.versioned.problems() : [];
  }
}
