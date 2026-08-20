import assert from 'node:assert/strict'
import test from 'node:test'
import { TurnGovernor } from '../rlm-lib/turn.ts'
import { RlmError } from '../rlm-lib/errors.ts'

function sdkFor(getMessages) {
  return { session: { messages: async () => ({ data: getMessages() }) } }
}

function firstTurn() {
  return [
    { info: { id: 'user-1', role: 'user' } },
    { info: { id: 'assistant-1', role: 'assistant' } },
  ]
}

function secondTurn() {
  return [
    ...firstTurn(),
    { info: { id: 'user-2', role: 'user' } },
    { info: { id: 'assistant-2', role: 'assistant' } },
  ]
}

test('new user turn fails closed while a prior-turn production exec is active', async () => {
  const governor = new TurnGovernor()
  let messages = firstTurn()
  const sdk = sdkFor(() => messages)
  const oldExec = await governor.beginExec(sdk, 'session', '/workspace', 'assistant-1', 100)
  assert.equal(oldExec.allowed, true)
  assert.equal(oldExec.reservedWallMs, 100)
  const before = governor.snapshot('session')

  messages = secondTurn()
  await assert.rejects(
    () => governor.beginExec(sdk, 'session', '/workspace', 'assistant-2', 100),
    (error) => error instanceof RlmError
      && error.code === 'RUNTIME_ERROR'
      && /prior-turn exec\(s\) are still active/.test(error.message),
  )
  assert.deepEqual(governor.snapshot('session'), before, 'failed transition must not reset or charge either turn')

  assert.equal(governor.finishExecForTurn('session', oldExec.snapshot.turnId, 25, oldExec.reservedWallMs), true)
  const next = await governor.beginExec(sdk, 'session', '/workspace', 'assistant-2', 100)
  assert.equal(next.allowed, true)
  assert.equal(next.snapshot.turnId, 'user-2')
  assert.equal(next.snapshot.execCount, 1)
  assert.equal(next.snapshot.childCallCount, 0)
  assert.equal(next.snapshot.contextCallCount, 0)
  assert.equal(next.snapshot.contextCharsSent, 0)
})

test('all prior-turn production execs must finish before transition', async () => {
  const governor = new TurnGovernor()
  let messages = firstTurn()
  const sdk = sdkFor(() => messages)
  const first = await governor.beginExec(sdk, 'session', '/workspace', 'assistant-1', 10)
  const second = await governor.beginExec(sdk, 'session', '/workspace', 'assistant-1', 10)
  messages = secondTurn()

  assert.equal(governor.finishExecForTurn('session', first.snapshot.turnId, 1, first.reservedWallMs), true)
  await assert.rejects(
    () => governor.beginExec(sdk, 'session', '/workspace', 'assistant-2', 10),
    /prior-turn exec\(s\) are still active/,
  )
  assert.equal(governor.finishExecForTurn('session', second.snapshot.turnId, 1, second.reservedWallMs), true)
  assert.equal((await governor.beginExec(sdk, 'session', '/workspace', 'assistant-2', 10)).snapshot.turnId, 'user-2')
})

test('finish for a non-authoritative turn cannot release active exec state', async () => {
  const governor = new TurnGovernor()
  let messages = firstTurn()
  const sdk = sdkFor(() => messages)
  const active = await governor.beginExec(sdk, 'session', '/workspace', 'assistant-1', 10)
  assert.equal(governor.finishExecForTurn('session', 'wrong-turn', 1, active.reservedWallMs), false)
  messages = secondTurn()
  await assert.rejects(
    () => governor.beginExec(sdk, 'session', '/workspace', 'assistant-2', 10),
    /prior-turn exec\(s\) are still active/,
  )
  assert.equal(governor.finishExecForTurn('session', active.snapshot.turnId, 1, active.reservedWallMs), true)
  assert.equal((await governor.beginExec(sdk, 'session', '/workspace', 'assistant-2', 10)).snapshot.turnId, 'user-2')
})

test('zero-wall unit-test seams do not create production lifecycle locks', async () => {
  const governor = new TurnGovernor()
  let messages = firstTurn()
  const sdk = sdkFor(() => messages)
  assert.equal((await governor.beginExec(sdk, 'session', '/workspace', 'assistant-1')).allowed, true)
  messages = secondTurn()
  assert.equal((await governor.beginExec(sdk, 'session', '/workspace', 'assistant-2')).snapshot.turnId, 'user-2')
})
