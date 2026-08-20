import assert from "node:assert/strict"
import test from "node:test"
import { isRlmContextPathAllowed, isRlmHiddenPath, parseRlmContextPolicy } from "../rlm-lib/context-policy.ts"

const full = parseRlmContextPolicy({})

test("context hard-denies common credential paths even under full-root policy", () => {
  for (const candidate of [
    ".git/config",
    ".env",
    ".env.production",
    ".npmrc",
    ".netrc",
    ".ssh/id_ed25519",
    ".aws/credentials",
    ".kube/config",
    ".gnupg/private-keys-v1.d/key",
    "credentials.json",
    "application_default_credentials.json",
    "deploy.pem",
    "private.key",
    "cert.p12",
    "cert.pfx",
    "terraform.tfstate",
    "terraform.tfstate.backup",
  ]) {
    assert.equal(isRlmHiddenPath(candidate), true, candidate)
    assert.equal(isRlmContextPathAllowed(candidate, full), false, candidate)
  }
})

test("credential hard-deny keeps explicit safe examples and ordinary source visible", () => {
  for (const candidate of [".env.example", "src/key.ts", "docs/credentials.md", "package-lock.json"]) {
    assert.equal(isRlmHiddenPath(candidate), false, candidate)
    assert.equal(isRlmContextPathAllowed(candidate, full), true, candidate)
  }
})
