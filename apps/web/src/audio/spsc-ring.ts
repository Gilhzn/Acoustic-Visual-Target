/**
 * Lock-free single-producer/single-consumer ring of fixed-size Float32 records,
 * backed by a SharedArrayBuffer so the audio/fusion worker and the main thread
 * exchange data without serialization or locks.
 *
 * Layout: an Int32 header [head, tail] + a Float32 data region of
 * capacity·stride. head/tail are monotonically increasing indices accessed with
 * acquire/release Atomics ordering. Capacity must be a power of two.
 */
const HEADER_INTS = 2;
const HEAD = 0;
const TAIL = 1;

export class SpscFloatRing {
  readonly capacity: number;
  readonly stride: number;
  private readonly header: Int32Array;
  private readonly data: Float32Array;

  constructor(buffer: SharedArrayBuffer | ArrayBuffer, capacity: number, stride: number) {
    if ((capacity & (capacity - 1)) !== 0) throw new Error("capacity must be a power of two");
    this.capacity = capacity;
    this.stride = stride;
    this.header = new Int32Array(buffer, 0, HEADER_INTS);
    this.data = new Float32Array(buffer, HEADER_INTS * 4, capacity * stride);
  }

  /** Bytes needed to back a ring of (capacity, stride). */
  static byteLength(capacity: number, stride: number): number {
    return HEADER_INTS * 4 + capacity * stride * 4;
  }

  /** Producer: copy `record` (length == stride) in. Returns false if full. */
  push(record: Float32Array): boolean {
    const head = Atomics.load(this.header, HEAD);
    const tail = Atomics.load(this.header, TAIL);
    if (head - tail >= this.capacity) return false;
    const base = (head & (this.capacity - 1)) * this.stride;
    for (let i = 0; i < this.stride; i++) this.data[base + i] = record[i];
    Atomics.store(this.header, HEAD, head + 1);
    return true;
  }

  /** Consumer: copy the oldest record into `out`. Returns false if empty. */
  pop(out: Float32Array): boolean {
    const tail = Atomics.load(this.header, TAIL);
    const head = Atomics.load(this.header, HEAD);
    if (tail === head) return false;
    const base = (tail & (this.capacity - 1)) * this.stride;
    for (let i = 0; i < this.stride; i++) out[i] = this.data[base + i];
    Atomics.store(this.header, TAIL, tail + 1);
    return true;
  }

  /** Consumer: drop all but the most recent record into `out`. Returns false if empty. */
  popLatest(out: Float32Array): boolean {
    let got = false;
    while (this.pop(out)) got = true;
    return got;
  }

  get size(): number {
    return Atomics.load(this.header, HEAD) - Atomics.load(this.header, TAIL);
  }
}
