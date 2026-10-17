import assert from "node:assert/strict"
import test from "node:test"

import { ChildCallScheduler } from "../rlm-lib/child-call-scheduler.ts"

test("child scheduler runs larger batches in bounded FIFO waves", async () => {
  const scheduler = new ChildCallScheduler(4)
  let active = 0
  let maxActive = 0
  const started = []

  const results = await Promise.all(Array.from({ length: 16 }, async (_, index) => {
    const granted = await scheduler.acquire()
    assert.equal(granted, true)
    active++
    maxActive = Math.max(maxActive, active)
    started.push(index)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--
    scheduler.release()
    return index
  }))

  assert.deepEqual(results, Array.from({ length: 16 }, (_, index) => index))
  assert.equal(maxActive, 4)
  assert.equal(scheduler.maxObserved, 4)
  assert.equal(scheduler.activeCount, 0)
  assert.equal(scheduler.pendingCount, 0)
  assert.deepEqual(started, Array.from({ length: 16 }, (_, index) => index))
})

test("child scheduler cancellation rejects queued work without disturbing active slots", async () => {
  const scheduler = new ChildCallScheduler(2)
  assert.equal(await scheduler.acquire(), true)
  assert.equal(await scheduler.acquire(), true)

  const queuedA = scheduler.acquire()
  const queuedB = scheduler.acquire()
  assert.equal(scheduler.pendingCount, 2)

  scheduler.cancelPending()
  assert.equal(await queuedA, false)
  assert.equal(await queuedB, false)
  assert.equal(await scheduler.acquire(), false)
  assert.equal(scheduler.activeCount, 2)

  scheduler.release()
  scheduler.release()
  assert.equal(scheduler.activeCount, 0)
  assert.equal(scheduler.pendingCount, 0)
})
