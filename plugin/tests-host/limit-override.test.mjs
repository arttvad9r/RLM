import assert from "node:assert/strict"
import test from "node:test"

import { narrowedTestLimit } from "../rlm-lib/limit-override.ts"

test("test limit overrides can narrow but never widen compiled hard limits", () => {
  const hardMax = 100
  assert.equal(narrowedTestLimit(undefined, hardMax), hardMax)
  assert.equal(narrowedTestLimit("", hardMax), hardMax)
  assert.equal(narrowedTestLimit("25", hardMax), 25)
  assert.equal(narrowedTestLimit("100", hardMax), hardMax)
  assert.equal(narrowedTestLimit("101", hardMax), hardMax)
  assert.equal(narrowedTestLimit("999999999", hardMax), hardMax)
  assert.equal(narrowedTestLimit("0", hardMax), hardMax)
  assert.equal(narrowedTestLimit("-1", hardMax), hardMax)
  assert.equal(narrowedTestLimit("1.5", hardMax), hardMax)
  assert.equal(narrowedTestLimit("Infinity", hardMax), hardMax)
  assert.equal(narrowedTestLimit("not-a-number", hardMax), hardMax)
})

test("test limit helper rejects an invalid compiled hard limit", () => {
  assert.throws(() => narrowedTestLimit("1", 0), /hardMax/)
  assert.throws(() => narrowedTestLimit("1", Number.POSITIVE_INFINITY), /hardMax/)
})
