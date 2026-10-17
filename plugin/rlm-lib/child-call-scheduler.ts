export class ChildCallScheduler {
  readonly limit: number
  #active = 0
  #maxObserved = 0
  #cancelled = false
  #waiters: Array<(granted: boolean) => void> = []

  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("child scheduler limit must be a positive integer")
    this.limit = limit
  }

  get activeCount(): number {
    return this.#active
  }

  get pendingCount(): number {
    return this.#waiters.length
  }

  get maxObserved(): number {
    return this.#maxObserved
  }

  acquire(): Promise<boolean> {
    if (this.#cancelled) return Promise.resolve(false)
    if (this.#active < this.limit) {
      this.#active++
      this.#maxObserved = Math.max(this.#maxObserved, this.#active)
      return Promise.resolve(true)
    }
    return new Promise<boolean>((resolve) => this.#waiters.push(resolve))
  }

  release(): void {
    if (this.#active > 0) this.#active--
    if (this.#cancelled) return
    const next = this.#waiters.shift()
    if (!next) return
    this.#active++
    this.#maxObserved = Math.max(this.#maxObserved, this.#active)
    next(true)
  }

  cancelPending(): void {
    this.#cancelled = true
    while (this.#waiters.length > 0) this.#waiters.shift()!(false)
  }
}
