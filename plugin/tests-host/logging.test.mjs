import assert from "node:assert/strict"
import test from "node:test"

import { logBestEffort } from "../rlm-lib/logging.ts"

test("best-effort logging does not wait for a never-settling logger", () => {
  const never = async () => await new Promise(() => {})
  const started = Date.now()
  logBestEffort(never, "debug", "x")
  assert.ok(Date.now() - started < 50)
})

test("best-effort logging swallows synchronous and asynchronous failures", async () => {
  assert.doesNotThrow(() => logBestEffort(() => { throw new Error("sync") }, "info", "x"))
  let unhandled = false
  const listener = () => { unhandled = true }
  process.once("unhandledRejection", listener)
  logBestEffort(async () => { throw new Error("async") }, "warn", "x")
  await new Promise((resolve) => setImmediate(resolve))
  process.removeListener("unhandledRejection", listener)
  assert.equal(unhandled, false)
})
