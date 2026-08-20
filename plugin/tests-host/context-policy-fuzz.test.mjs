import assert from "node:assert/strict"
import test from "node:test"

import { isRlmHiddenPath } from "../rlm-lib/context-policy.ts"

function rng(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomCase(value, next) {
  return [...value].map((char) => /[a-z]/i.test(char) && next() < 0.5 ? char.toUpperCase() : char.toLowerCase()).join("")
}

test("credential hard-deny is invariant under casing and harmless path prefixes", () => {
  const next = rng(0x524c4d)
  const sensitive = [
    ".git/config",
    ".ssh/id_ed25519",
    ".aws/credentials",
    ".azure/accessTokens.json",
    ".kube/config",
    ".gnupg/private-keys-v1.d/key",
    ".npmrc",
    ".netrc",
    ".pypirc",
    ".git-credentials",
    ".authinfo",
    ".vault-token",
    "credentials.json",
    "application_default_credentials.json",
    "terraform.tfstate.backup",
    "deploy.pem",
    "private.ppk",
    "keystore.jks",
  ]
  for (let iteration = 0; iteration < 500; iteration++) {
    const original = sensitive[Math.floor(next() * sensitive.length)]
    const candidate = `${iteration % 2 === 0 ? "src/cache/" : ""}${randomCase(original, next)}`
    assert.equal(isRlmHiddenPath(candidate), true, candidate)
  }
})

test(".env.example exception applies only to the terminal file", () => {
  assert.equal(isRlmHiddenPath(".env.example"), false)
  assert.equal(isRlmHiddenPath("config/.env.example"), false)
  assert.equal(isRlmHiddenPath(".env.example/secret"), true)
  assert.equal(isRlmHiddenPath("config/.ENV.EXAMPLE/secret"), true)
})
