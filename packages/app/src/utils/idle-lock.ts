/** Compare wall time before accepting activity, including after mobile suspension. */
export class IdleLock {
  private lastActivity: number;
  constructor(private readonly now: () => number = Date.now) {
    this.lastActivity = now();
  }
  expired(minutes: number): boolean {
    return minutes > 0 && this.now() - this.lastActivity >= minutes * 60000;
  }
  activity(minutes: number): boolean {
    if (this.expired(minutes)) return true;
    this.lastActivity = this.now();
    return false;
  }
  reset(): void {
    this.lastActivity = this.now();
  }
}
