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
const EXPECTED_COUNTS = Object.freeze({ violation: 12, decoy: 36, neutral: 48, total: 96 })

const sha = (t) => createHash("sha256").update(t).digest("hex")

let failed = false
const check = (label, expected, actual) => {
  const ok = expected === actual
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${actual}`)
  if (!ok) failed = true
}

function classCounts(groundTruth) {
  if (!Array.isArray(groundTruth?.cases)) throw new Error("ground truth cases must be an array")
  const counts = { violation: 0, decoy: 0, neutral: 0, total: groundTruth.cases.length }
  for (const item of groundTruth.cases) {
    if (!item || typeof item !== "object" || !Object.hasOwn(counts, item.class) || item.class === "total") {
      throw new Error(`ground truth contains unknown class: ${String(item?.class)}`)
    }
    counts[item.class]++
  }
  return counts
}

const generator = readFileSync(join(ROOT, "generator", "generate-semantic-state-audit.mjs"), "utf8")
const gtText = readFileSync(GT_PATH, "utf8")
const groundTruth = JSON.parse(gtText)
const actualCounts = classCounts(groundTruth)
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
for (const key of ["violation", "decoy", "neutral", "total"]) {
  check(`ground-truth ${key} vs manifest`, String(manifest.counts[key]), String(actualCounts[key]))
  check(`ground-truth ${key} vs frozen expectation`, String(EXPECTED_COUNTS[key]), String(actualCounts[key]))
}

if (failed) {
  console.error("INTEGRITY FAILED")
  process.exit(1)
}
console.log("INTEGRITY OK")
