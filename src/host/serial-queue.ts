// Serialize complete operations, including read-modify-write transactions.
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  get busy() {
    return this.pending > 0;
  }
  run<T>(operation: () => T | Promise<T>): Promise<T> {
    this.pending++;
    const result = this.tail.then(operation).finally(() => this.pending--);
    this.tail = result.catch(() => {});
    return result;
  }
  idle() {
    return this.tail;
  }
}
