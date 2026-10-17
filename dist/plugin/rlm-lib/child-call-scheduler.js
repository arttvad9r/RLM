export class ChildCallScheduler {
    limit;
    #active = 0;
    #maxObserved = 0;
    #cancelled = false;
    #waiters = [];
    constructor(limit) {
        if (!Number.isSafeInteger(limit) || limit < 1)
            throw new Error("child scheduler limit must be a positive integer");
        this.limit = limit;
    }
    get activeCount() {
        return this.#active;
    }
    get pendingCount() {
        return this.#waiters.length;
    }
    get maxObserved() {
        return this.#maxObserved;
    }
    acquire() {
        if (this.#cancelled)
            return Promise.resolve(false);
        if (this.#active < this.limit) {
            this.#active++;
            this.#maxObserved = Math.max(this.#maxObserved, this.#active);
            return Promise.resolve(true);
        }
        return new Promise((resolve) => this.#waiters.push(resolve));
    }
    release() {
        if (this.#active > 0)
            this.#active--;
        if (this.#cancelled)
            return;
        const next = this.#waiters.shift();
        if (!next)
            return;
        this.#active++;
        this.#maxObserved = Math.max(this.#maxObserved, this.#active);
        next(true);
    }
    cancelPending() {
        this.#cancelled = true;
        while (this.#waiters.length > 0)
            this.#waiters.shift()(false);
    }
}
