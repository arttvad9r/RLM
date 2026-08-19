#!/usr/bin/env node
/**
 * Integrity verification for semantic-state-audit-v2-192.
 *
 * Recomputes every hash recorded in the v2 manifest and exits non-zero on any
 * mismatch. v1 integrity is checked separately by generator/verify.mjs.
 * Run:  node generator/verify-v2.mjs
 */
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertCorpusNamesMatchGroundTruth } from "../harness/corpus-layout.mjs"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const ROOT = join(__dirname, "..")
const CORPUS_DIR = join(ROOT, "corpora", "semantic-state-audit-v2-192")
const GT_PATH = join(ROOT, "ground-truth", "semantic-state-audit-v2-192.json")
const MANIFEST_PATH = join(ROOT, "manifests", "semantic-state-audit-v2-192.json")

const sha = (t) => createHash("sha256").update(t).digest("hex")

let failed = false
const check = (label, expected, actual) => {
  const ok = expected === actual
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${actual}`)
  if (!ok) failed = true
}

const generator = readFileSync(join(ROOT, "generator", "generate-semantic-state-audit-v2.mjs"), "utf8")
const gtText = readFileSync(GT_PATH, "utf8")
const groundTruth = JSON.parse(gtText)
const files = readdirSync(join(CORPUS_DIR, "src")).filter((f) => f.endsWith(".ts")).sort()
assertCorpusNamesMatchGroundTruth(groundTruth, files)
const h = createHash("sha256")
for (const f of files) {
  h.update(f)
  h.update("\n")
  h.update(readFileSync(join(CORPUS_DIR, "src", f), "utf8"))
}
const aggregate = h.digest("hex")

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))

console.log(`corpus src files: ${files.length} (manifest generated_file_count: ${manifest.generated_file_count})`)
check("generator sha256", manifest.sha256.generator, sha(generator))
check("ground-truth sha256", manifest.sha256.ground_truth, sha(gtText))
check("corpus aggregate sha256", manifest.sha256.corpus_aggregate, aggregate)
check("generated file count", String(manifest.generated_file_count), String(files.length))
check("violation count", String(24), String(manifest.counts.violation))
check("decoy count", String(72), String(manifest.counts.decoy))
check("neutral count", String(96), String(manifest.counts.neutral))

if (failed) {
  console.error("INTEGRITY FAILED")
  process.exit(1)
}
console.log("INTEGRITY OK")
