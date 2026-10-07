/**
 * The last `limit` characters of a stream of text. Pieces are kept as they come
 * and joined only when they add up to twice the limit, so a long stream costs its
 * own length rather than its length times the limit.
 */
export class Tail {
  private parts: string[] = [];
  private length = 0;
  constructor(private limit: number) {}
  add(text: string) {
    if (!text) return;
    this.parts.push(text);
    this.length += text.length;
    if (this.length > 2 * this.limit) this.join();
  }
  private join() {
    const text = this.parts.join('').slice(-this.limit);
    this.parts = [text];
    this.length = text.length;
  }
  clear() {
    this.parts = [];
    this.length = 0;
  }
  toString() {
    if (this.parts.length !== 1 || this.length > this.limit) this.join();
    return this.parts[0] ?? '';
  }
}
