// Debounced, serialised saving: at most one request in flight; edits made meanwhile are sent
// (once, with the latest state) after it finishes. `send` reads the latest state itself.

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export class SaveQueue {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private dirty = false;
  private stopped = false;

  constructor(
    private readonly send: () => Promise<void>,
    private readonly onState: (s: SaveState) => void = () => {},
    private readonly delayMs = 400,
  ) {}

  /** Marks the state changed; sends `delayMs` after the last call (or after the in-flight request). */
  schedule(): void {
    if (this.stopped) return;
    this.dirty = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.inFlight === null) this.run();
    }, this.delayMs);
    this.onState({ kind: this.inFlight ? 'saving' : 'pending' });
  }

  /** Sends any pending change now and resolves once nothing is pending or in flight. Never rejects. */
  async flush(): Promise<void> {
    while (!this.stopped && (this.timer !== null || this.inFlight !== null || this.dirty)) {
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.inFlight === null) {
        if (!this.dirty) break;
        this.run();
      }
      await this.inFlight;
    }
  }

  /** Drops anything pending (e.g. the crate was deleted). An in-flight request still completes. */
  stop(): void {
    this.stopped = true;
    this.dirty = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  get busy(): boolean {
    return this.timer !== null || this.inFlight !== null || this.dirty;
  }

  private run(): void {
    this.dirty = false;
    this.onState({ kind: 'saving' });
    this.inFlight = this.send().then(
      () => {
        this.onState({ kind: this.dirty ? 'pending' : 'saved' });
      },
      (e: unknown) => {
        this.onState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      },
    ).finally(() => {
      this.inFlight = null;
      // Changed while in flight and its debounce already elapsed: send the latest state now.
      if (this.dirty && this.timer === null && !this.stopped) this.run();
    });
  }
}
