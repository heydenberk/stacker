import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveQueue, type SaveState } from './save-queue';

/** A send() whose calls stay open until resolved by hand. */
function controlledSend() {
  const calls: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  const send = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return { send, calls };
}

const tick = () => vi.advanceTimersByTimeAsync(0);

describe('SaveQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces: sends once, 400 ms after the last change', async () => {
    const { send, calls } = controlledSend();
    const q = new SaveQueue(send);
    q.schedule();
    await vi.advanceTimersByTimeAsync(300);
    q.schedule();
    await vi.advanceTimersByTimeAsync(399);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    calls[0].resolve();
    await tick();
    expect(q.busy).toBe(false);
  });

  it('never has two requests in flight; changes made meanwhile are sent once afterwards', async () => {
    const { send, calls } = controlledSend();
    const q = new SaveQueue(send);
    q.schedule();
    await vi.advanceTimersByTimeAsync(400);
    expect(send).toHaveBeenCalledTimes(1);

    q.schedule();
    await vi.advanceTimersByTimeAsync(400);
    q.schedule();
    await vi.advanceTimersByTimeAsync(400);
    expect(send).toHaveBeenCalledTimes(1); // still waiting on the first

    calls[0].resolve();
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    calls[1].resolve();
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(q.busy).toBe(false);
  });

  it('waits for the debounce when a change lands just before the in-flight request finishes', async () => {
    const { send, calls } = controlledSend();
    const q = new SaveQueue(send);
    q.schedule();
    await vi.advanceTimersByTimeAsync(400);
    q.schedule();
    calls[0].resolve();
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports pending, saving, saved and errors', async () => {
    const { send, calls } = controlledSend();
    const states: SaveState[] = [];
    const q = new SaveQueue(send, (s) => states.push(s));
    q.schedule();
    await vi.advanceTimersByTimeAsync(400);
    calls[0].resolve();
    await tick();
    q.schedule();
    await vi.advanceTimersByTimeAsync(400);
    calls[1].reject(new Error('Name must not be blank'));
    await tick();
    expect(states.map((s) => s.kind)).toEqual(['pending', 'saving', 'saved', 'pending', 'saving', 'error']);
    expect(states.at(-1)).toEqual({ kind: 'error', message: 'Name must not be blank' });
  });

  it('flush sends a pending change immediately and resolves when idle', async () => {
    const { send, calls } = controlledSend();
    const q = new SaveQueue(send);
    q.schedule();
    let done = false;
    const flushed = q.flush().then(() => (done = true));
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    calls[0].resolve();
    await flushed;
    expect(done).toBe(true);
    expect(q.busy).toBe(false);
  });

  it('flush also sends a change queued behind the in-flight request', async () => {
    const { send, calls } = controlledSend();
    const q = new SaveQueue(send);
    q.schedule();
    await vi.advanceTimersByTimeAsync(400);
    q.schedule();
    const flushed = q.flush();
    calls[0].resolve();
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    calls[1].resolve();
    await flushed;
    expect(q.busy).toBe(false);
  });

  it('flush resolves even when the save fails', async () => {
    const q = new SaveQueue(() => Promise.reject(new Error('boom')));
    q.schedule();
    await expect(q.flush()).resolves.toBeUndefined();
  });

  it('stop drops pending changes', async () => {
    const { send } = controlledSend();
    const q = new SaveQueue(send);
    q.schedule();
    q.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).not.toHaveBeenCalled();
    q.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).not.toHaveBeenCalled();
  });
});
