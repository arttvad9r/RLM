import assert from "node:assert/strict"
import test from "node:test"

import {
  isRlmContextPathAllowed,
  isRlmHiddenPath,
  parseRlmContextPolicy,
} from "../rlm-lib/context-policy.ts"

const full = parseRlmContextPolicy({})

function assertHidden(candidate) {
  assert.equal(isRlmHiddenPath(candidate), true, candidate)
  assert.equal(isRlmContextPathAllowed(candidate, full), false, candidate)
}

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
  ]) assertHidden(candidate)
})

test("credential hard-deny is case-insensitive", () => {
  for (const candidate of [
    ".GIT/config",
    ".Env.Production",
    ".SSH/id_rsa",
    ".AWS/credentials",
    ".NPMRC",
    "Credentials.json",
    "DEPLOY.PEM",
    "Terraform.tfstate",
  ]) assertHidden(candidate)
})

test(".env.example exception applies only to the example file, not descendants", () => {
  for (const candidate of [".env.example", ".ENV.EXAMPLE", "config/.env.example"]) {
    assert.equal(isRlmHiddenPath(candidate), false, candidate)
    assert.equal(isRlmContextPathAllowed(candidate, full), true, candidate)
  }
  for (const candidate of [".env.example/secret", "config/.env.example/token", ".ENV.EXAMPLE/secret"]) {
    assertHidden(candidate)
  }
})

test("context hard-denies additional common credential stores", () => {
  for (const candidate of [
    ".config/gcloud/credentials.db",
    ".CONFIG/GCLOUD/access_tokens.db",
    ".azure/accessTokens.json",
    ".docker/config.json",
    ".gem/credentials",
    ".pypirc",
    ".git-credentials",
    ".authinfo",
    ".authinfo.gpg",
    ".vault-token",
    "id_rsa",
    "keys/id_ed25519",
    "private.ppk",
    "signing.jks",
  ]) assertHidden(candidate)
})

test("credential hard-deny keeps ordinary source and documentation visible", () => {
  for (const candidate of ["src/key.ts", "docs/credentials.md", "package-lock.json", ".docker/README.md"]) {
    assert.equal(isRlmHiddenPath(candidate), false, candidate)
    assert.equal(isRlmContextPathAllowed(candidate, full), true, candidate)
  }
})
