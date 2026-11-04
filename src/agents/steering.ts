/**
 * Words the person sends to a run in progress, which its CLI takes at its next
 * step without stopping (ADR 056). True once the CLI has them.
 */
export type Steer = (text: string) => Promise<boolean>;

/**
 * Whether a run takes words while it works, and how. A CLI that can opens it
 * once its turn is under way and closes it when the turn can take no more; a
 * run that never can is closed from the start.
 */
export class Steering {
  private steer?: Steer;
  private ended = false;
  private waiting: (() => void)[] = [];
  open(steer: Steer) {
    if (this.ended) return;
    this.steer = steer;
    this.wake();
  }
  close() {
    this.ended = true;
    this.steer = undefined;
    this.wake();
  }
  /** The run's way to take words, once its turn is under way; none when it cannot. */
  async ready(): Promise<Steer | undefined> {
    while (!this.steer && !this.ended)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    return this.steer;
  }
  private wake() {
    for (const resolve of this.waiting.splice(0)) resolve();
  }
}

/**
 * Messages a CLI reads one after another, as an async iterable that ends once
 * it is closed and what was pushed before has been read.
 */
export class MessageChannel<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private closed = false;
  private wake?: () => void;
  /** False once closed: nothing more is read. */
  push(item: T) {
    if (this.closed) return false;
    this.items.push(item);
    this.wake?.();
    return true;
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      const item = this.items.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }
}
