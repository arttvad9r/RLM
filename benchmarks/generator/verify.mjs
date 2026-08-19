#!/usr/bin/env node
/**
 * Integrity verification for the semantic-state-audit-v1 benchmark.
 *
 * Recomputes every hash recorded in the manifest and exits non-zero on any
 * mismatch. Run:  node generator/verify.mjs
 */
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertCorpusNamesMatchGroundTruth } from "../harness/corpus-layout.mjs"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const ROOT = join(__dirname, "..")
const CORPUS_DIR = join(ROOT, "corpora", "semantic-state-audit-v1")
const GT_PATH = join(ROOT, "ground-truth", "semantic-state-audit-v1.json")
const MANIFEST_PATH = join(ROOT, "manifests", "semantic-state-audit-v1.json")

const sha = (t) => createHash("sha256").update(t).digest("hex")

let failed = false
const check = (label, expected, actual) => {
  const ok = expected === actual
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${actual}`)
  if (!ok) failed = true
}

// generator source hash
const generator = readFileSync(join(ROOT, "generator", "generate-semantic-state-audit.mjs"), "utf8")
// ground truth hash
const gtText = readFileSync(GT_PATH, "utf8")
const groundTruth = JSON.parse(gtText)
// corpus aggregate: sorted file names + contents
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

console.log(`corpus src files: ${files.length} (all 96 include src/api.ts; manifest cases: ${manifest.generated_file_count})`)
check("generator sha256", manifest.sha256.generator, sha(generator))
check("ground-truth sha256", manifest.sha256.ground_truth, sha(gtText))
check("corpus aggregate sha256", manifest.sha256.corpus_aggregate, aggregate)
check("generated file count", String(manifest.generated_file_count), String(files.length))

if (failed) {
  console.error("INTEGRITY FAILED")
  process.exit(1)
}
console.log("INTEGRITY OK")
