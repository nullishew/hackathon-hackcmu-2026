/** Minimal binary min-heap. Avoids a dependency for the one place we need a priority queue. */
export class MinHeap<T> {
  private items: T[] = []
  private readonly score: (item: T) => number

  constructor(score: (item: T) => number) {
    this.score = score
  }

  get size(): number {
    return this.items.length
  }

  push(item: T): void {
    this.items.push(item)
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.score(this.items[i]) >= this.score(this.items[parent])) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): T | undefined {
    const { items } = this
    if (items.length === 0) return undefined
    const top = items[0]
    const last = items.pop()!
    if (items.length > 0) {
      items[0] = last
      this.sinkDown(0)
    }
    return top
  }

  private sinkDown(start: number): void {
    const { items } = this
    const n = items.length
    let i = start
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let smallest = i
      if (l < n && this.score(items[l]) < this.score(items[smallest])) smallest = l
      if (r < n && this.score(items[r]) < this.score(items[smallest])) smallest = r
      if (smallest === i) return
      this.swap(i, smallest)
      i = smallest
    }
  }

  private swap(a: number, b: number): void {
    const t = this.items[a]
    this.items[a] = this.items[b]
    this.items[b] = t
  }
}
