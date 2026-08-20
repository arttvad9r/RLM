import assert from "node:assert/strict"
import test from "node:test"

import {
  PINNED_DENO_VERSION,
  PINNED_NODE_VERSION,
  assertCompatibleRuntime,
  parseRuntimeVersion,
} from "../../scripts/check-runtime.mjs"

test("runtime parser accepts Node/Deno version output and rejects garbage", () => {
  assert.deepEqual(parseRuntimeVersion("v24.19.0", "Node.js"), { raw: "24.19.0", major: 24, minor: 19, patch: 0 })
  assert.deepEqual(parseRuntimeVersion("deno 2.9.5 (stable, release, x86_64-unknown-linux-gnu)", "Deno"), { raw: "2.9.5", major: 2, minor: 9, patch: 5 })
  assert.throws(() => parseRuntimeVersion("latest", "runtime"), /could not parse runtime version/)
})

test("compatible runtime gate accepts supported majors and exact pins", () => {
  assert.doesNotThrow(() => assertCompatibleRuntime({ nodeVersion: "24.99.1", denoVersion: "2.11.0" }))
  assert.doesNotThrow(() => assertCompatibleRuntime({ nodeVersion: PINNED_NODE_VERSION, denoVersion: PINNED_DENO_VERSION, exact: true }))
  assert.throws(() => assertCompatibleRuntime({ nodeVersion: "22.16.0", denoVersion: "2.9.5" }), /Node\.js 24\.x/)
  assert.throws(() => assertCompatibleRuntime({ nodeVersion: "24.19.0", denoVersion: "1.46.3" }), /Deno 2\.x/)
  assert.throws(() => assertCompatibleRuntime({ nodeVersion: "24.18.1", denoVersion: PINNED_DENO_VERSION, exact: true }), /exact RLM gate/)
  assert.throws(() => assertCompatibleRuntime({ nodeVersion: PINNED_NODE_VERSION, denoVersion: "2.9.4", exact: true }), /exact RLM gate/)
})
