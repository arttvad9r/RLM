import assert from "node:assert/strict"
import test from "node:test"

import {
  activeRlmChildCount,
  forgetDeletedRlmChild,
  isRlmChild,
  registerRlmChild,
  unregisterRlmChild,
} from "../rlm-lib/child-system.ts"

test("authoritative session deletion removes an active RLM child from the registry", () => {
  const sessionID = `deleted-child-${Date.now()}-${Math.random()}`
  registerRlmChild(sessionID)
  assert.equal(isRlmChild(sessionID), true)
  assert.equal(forgetDeletedRlmChild(sessionID), true)
  assert.equal(isRlmChild(sessionID), false)
  assert.equal(activeRlmChildCount(), 0)

  // callChildLlm's eventual finally remains safe after lifecycle cleanup.
  unregisterRlmChild(sessionID)
  assert.equal(activeRlmChildCount(), 0)
})
