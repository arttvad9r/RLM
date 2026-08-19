#!/usr/bin/env node
/**
 * RLM benchmark — deterministic corpus generator for
 * `semantic-state-audit-v2-192` (192-case scaling corpus).
 *
 * Independent generator; does NOT modify or share code with the v1 generator.
 * Single source of truth: fixed seed fully reproduces corpus + ground truth,
 * byte-identical on regeneration.
 *
 * Semantic invariant (identical to v1):
 *   VIOLATION: business/domain/UI RESULT state is changed before a successful
 *     awaited async backend/worker operation completes.
 *   DECOY: lifecycle/in-flight state (loading/busy/pending/syncing/...) before
 *     await, or result state changed only after a successful await, or
 *     local-only mutation with no backend coupling.
 *   NEUTRAL: no async backend/worker operation / backend-mock implementation
 *     code without a corresponding domain/UI result-state mutation.
 *
 * Counts: 24 violation / 72 decoy / 96 neutral (src/api.ts is one of the 96
 * neutrals, subtype `backend-support`), 192 .ts files total.
 *
 * File names are generated with a NEW deterministic namespace (different from
 * v1) and never reveal the case class.
 */

import { createHash } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const ROOT = join(__dirname, "..")

const SEED = 20260816
const CORPUS_DIR = join(ROOT, "corpora", "semantic-state-audit-v2-192")
const GT_PATH = join(ROOT, "ground-truth", "semantic-state-audit-v2-192.json")
const MANIFEST_PATH = join(ROOT, "manifests", "semantic-state-audit-v2-192.json")

// ---- deterministic PRNG (mulberry32) --------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// NEW name/verb/field pools — distinct from v1 names.
const NAME_POOL = [
  "arcade", "beacon", "browser", "chamber", "console", "cradle", "dial", "drum",
  "escalator", "flap", "funnel", "gauge", "hatch", "hub", "inbox", "joint",
  "keypad", "lobby", "motor", "notch", "orbit", "paddle", "quill", "racket",
  "revolver", "socket", "spindle", "switch", "trailer", "tuner", "valve", "whip",
]

const FIELD_RESULT = [
  "archive", "batch", "bucket", "digest", "document", "entries", "factor",
  "fragment", "inventory", "ledgerView", "manifest", "payload", "reportSet",
  "resultSet", "score", "selection", "snapshot", "tally", "totalValue", "viewport",
]

const FIELD_LIFECYCLE = [
  "booting", "fetching", "initializing", "pendingFlag", "processing", "queued",
  "refreshing", "rendering", "saving", "sweeping", "syncing", "warming",
]

const OP_KINDS = [
  { backend: "backend", verb: "command", nouns: ["apply", "commit", "dispatch", "finalize", "persist", "publish", "register", "submit", "synchronize"] },
  { backend: "worker", verb: "command", nouns: ["collect", "compile", "consume", "harvest", "ingest", "load", "materialize", "pull", "render"] },
]

const awaitLine = (backend, verb, noun) =>
  `const result = await ${backend}.${verb}({ key: "${noun}", draft: "" })`

// ---- template library ------------------------------------------------------
// VIOLATION: result state mutated before await (6 structural variants).
const VIOLATION_TEMPLATES = [
  // (1) result array assigned before await, replaced after success
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Controller {`,
    `  ${f.state} = [] as string[]`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state} = this.${f.state}.concat(["draft-${f.noun}"])`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.${f.state} = [result.id ?? ""]`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
  // (2) numeric result field incremented before await
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Counter {`,
    `  ${f.state} = 0`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state} += 1`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.${f.state} = result.ok ? 1 : 0`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
  // (3) object/record result fields mutated before await
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Registry {`,
    `  ${f.state} = { done: false, text: "" }`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state}.done = true`,
    `    this.${f.state}.text = "unconfirmed"`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.${f.state}.text = result.id ?? ""`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
  // (4) Set result mutated before await
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}SetView {`,
    `  ${f.state} = new Set<string>()`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state}.add("preview")`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.${f.state}.add(result.id ?? "")`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
  // (5) boolean result flag set before await (stays true on failure)
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Toggle {`,
    `  ${f.state} = false`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state} = true`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.${f.state} = true`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
  // (6) string result field assigned before await
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Writer {`,
    `  ${f.state} = ""`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state} = "pending-value"`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.${f.state} = result.id ?? ""`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
]

// DECOY: correct patterns.
const DECOY_TEMPLATES = [
  // (7) lifecycle flag before await, reset after — correct
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Indicator {`,
    `  ${f.state} = false`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state} = true`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    this.${f.state} = false`,
    `  }`,
    `}`,
    "",
  ],
  // (8) result state updated only after successful await — correct
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Fetcher {`,
    `  ${f.state} = [] as string[]`,
    "",
    `  async ${f.method}() {`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.${f.state} = [result.id ?? ""]`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
  // (9) lifecycle loading map before await — correct
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Loader {`,
    `  ${f.state} = new Map<string, unknown>()`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state}.set("phase", "loading")`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.${f.state}.set("phase", "done")`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
  // (10) pending lifecycle counter before await — correct
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Pending {`,
    `  ${f.state} = 0`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state} += 1`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    this.${f.state} -= 1`,
    `  }`,
    `}`,
    "",
  ],
  // (11) local-only scratch mutation before await, no result coupling — correct
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Local {`,
    `  ${f.state} = [] as string[]`,
    `  temp = ""`,
    "",
    `  async ${f.method}() {`,
    `    this.temp = "local"`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.temp = ""`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
  // (12) lifecycle syncing flag before await — correct
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Syncing {`,
    `  ${f.state} = false`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state} = true`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.${f.state} = false`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
  // (13) result state replaced after await via .then — correct
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Then {`,
    `  ${f.state} = 0`,
    "",
    `  ${f.method}() {`,
    `    return ${f.backend}.${f.verb}({ key: "${f.noun}" }).then((result) => {`,
    `      if (result.ok) this.${f.state} = 1`,
    `    })`,
    `  }`,
    `}`,
    "",
  ],
  // (14) lifecycle submitting flag before await — correct
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Submitting {`,
    `  ${f.state} = false`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state} = true`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.${f.state} = false`,
    `    } else {`,
    `      this.${f.state} = false`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
  // (15) lifecycle pending map counter before await — correct
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Warming {`,
    `  ${f.state} = new Map<string, number>()`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state}.set("queue", (this.${f.state}.get("queue") ?? 0) + 1)`,
    `    ${awaitLine(f.backend, f.verb, f.noun)}`,
    `    if (result.ok) {`,
    `      this.${f.state}.delete("queue")`,
    `    }`,
    `  }`,
    `}`,
    "",
  ],
]

// NEUTRAL: no backend operation (local-only).
const NEUTRAL_TEMPLATES = [
  (f) => [
    `export class ${f.Cls}Local1 {`,
    `  ${f.state} = 0`,
    "",
    `  ${f.method}() {`,
    `    this.${f.state} += 1`,
    `  }`,
    `}`,
    "",
  ],
  (f) => [
    `export class ${f.Cls}Local2 {`,
    `  ${f.state} = [] as string[]`,
    "",
    `  ${f.method}() {`,
    `    this.${f.state} = this.${f.state}.concat("x")`,
    `  }`,
    `}`,
    "",
  ],
  (f) => [
    `export class ${f.Cls}Local3 {`,
    `  ${f.state} = new Map<string, string>()`,
    "",
    `  ${f.method}(k: string) {`,
    `    this.${f.state}.set(k, k)`,
    `  }`,
    `}`,
    "",
  ],
  (f) => [
    `export class ${f.Cls}Local4 {`,
    `  ${f.state} = false`,
    "",
    `  ${f.method}() {`,
    `    this.${f.state} = !this.${f.state}`,
    `  }`,
    `}`,
    "",
  ],
]

// Shared backend/worker API. Part of the neutral set (backend/mock
// implementation without a corresponding domain/UI result-state mutation).
const API_BODY = `// Shared async backend/worker API used across the application.
export interface CommandResult {
  ok: boolean
  id?: string
}

export interface BackendClient {
  command(payload: Record<string, unknown>): Promise<CommandResult>
  stream?(payload: Record<string, unknown>): Promise<CommandResult>
}

export const backend: BackendClient = {
  async command(payload) {
    await new Promise((r) => setTimeout(r, 5))
    return { ok: true, id: String(payload.key ?? "cmd") }
  },
}

export const worker: BackendClient = {
  async command(payload) {
    await new Promise((r) => setTimeout(r, 5))
    return { ok: true, id: String(payload.key ?? "wrk") }
  },
}
`

// ---- deterministic case generation -----------------------------------------
function templateSubtype(cls, template) {
  if (cls === "violation") return VIOLATION_TEMPLATES.indexOf(template) + 1
  if (cls === "decoy") return 100 + DECOY_TEMPLATES.indexOf(template)
  return 200 + NEUTRAL_TEMPLATES.indexOf(template)
}

function generateCase(index, cls, template, rng, backendPool) {
  const word = (pool) => pool[Math.floor(rng() * pool.length)]
  const name = NAME_POOL[index % NAME_POOL.length]
  const Cls = cap(name) + cap(String(index + 1).padStart(3, "0"))
  const method = "run" + cap(word(["request", "change", "action", "update", "event", "command"]))
  const backendEntry = backendPool[index % backendPool.length]
  const f = {
    Cls,
    method,
    backend: backendEntry.backend,
    verb: backendEntry.verb,
    noun: word(backendEntry.nouns),
    state: word(FIELD_RESULT),
  }
  // lifecycle decoys use lifecycle field names
  const lifecycleIdx = [0, 3, 5, 6, 7, 8]
  if (cls === "decoy" && lifecycleIdx.includes(DECOY_TEMPLATES.indexOf(template))) f.state = word(FIELD_LIFECYCLE)
  return { body: template(f).join("\n"), f, subtype: templateSubtype(cls, template) }
}

function genCorpus() {
  const rng = mulberry32(SEED)
  const backendPool = OP_KINDS

  const cases = []
  // 24 violations: cycle 6 templates x4
  for (let i = 0; i < 24; i++) cases.push({ cls: "violation", template: VIOLATION_TEMPLATES[i % VIOLATION_TEMPLATES.length] })
  // 72 decoys: cycle 9 templates x8
  for (let i = 0; i < 72; i++) cases.push({ cls: "decoy", template: DECOY_TEMPLATES[i % DECOY_TEMPLATES.length] })
  // 95 neutral templates + src/api.ts = 96
  for (let i = 0; i < 95; i++) cases.push({ cls: "neutral", template: NEUTRAL_TEMPLATES[i % NEUTRAL_TEMPLATES.length] })

  // Deterministic shuffle.
  const order = []
  for (let i = 0; i < cases.length; i++) order.push(i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }

  const fileNames = new Set()
  const fileName = () => {
    for (;;) {
      const n = NAME_POOL[Math.floor(rng() * NAME_POOL.length)]
      const suffix = String(Math.floor(rng() * 90000) + 10000)
      const candidate = `${n}${suffix}.ts`
      if (!fileNames.has(candidate)) {
        fileNames.add(candidate)
        return candidate
      }
    }
  }

  const records = []
  for (let i = 0; i < cases.length; i++) {
    const spec = cases[order[i]]
    const name = fileName()
    const g = generateCase(i, spec.cls, spec.template, rng, backendPool)
    records.push({ path: `src/${name}`, cls: spec.cls, subtype: g.subtype, ...g.f, body: g.body })
  }
  records.push({
    path: "src/api.ts",
    cls: "neutral",
    subtype: "backend-support",
    state: "(none)",
    backend: "backend",
    verb: "command",
    body: API_BODY,
  })
  return records
}

// ---- ground truth ----------------------------------------------------------
function buildGroundTruth(records) {
  const violations = records.filter((r) => r.cls === "violation").map((r) => ({
    path: r.path,
    class: "violation",
    scenario_subtype: `violation-${r.subtype}`,
    state_field: r.state,
    async_operation: `${r.backend}.${r.verb}`,
    reason: `observable result state "${r.state}" is mutated before the awaited ${r.backend}.${r.verb}() completes`,
  }))
  const decoys = records.filter((r) => r.cls === "decoy").map((r) => ({
    path: r.path,
    class: "decoy",
    scenario_subtype: `decoy-${r.subtype}`,
    state_field: r.state,
    async_operation: `${r.backend}.${r.verb}`,
    reason: `not a violation: lifecycle/local state or result updated only after successful completion`,
  }))
  const neutrals = records.filter((r) => r.cls === "neutral").map((r) => ({
    path: r.path,
    class: "neutral",
    scenario_subtype: `neutral-${r.subtype}`,
    state_field: r.state,
    async_operation: null,
    reason:
      r.subtype === "backend-support"
        ? "backend/mock implementation without corresponding domain/UI result-state mutation"
        : `no async backend/worker operation`,
  }))
  return {
    benchmark: "semantic-state-audit-v2-192",
    seed: SEED,
    invariant: "business/domain/UI result state changed before successful awaited async backend/worker completion",
    cases: [...violations, ...decoys, ...neutrals],
    expected_violation_paths: violations.map((v) => v.path),
    counts: { violation: violations.length, decoy: decoys.length, neutral: neutrals.length, total: records.length },
  }
}

// ---- hashing ---------------------------------------------------------------
const sha256 = (text) => createHash("sha256").update(text).digest("hex")

function corpusAggregateHash(root) {
  const files = readdirSync(join(root, "src")).filter((f) => f.endsWith(".ts")).sort()
  const h = createHash("sha256")
  for (const f of files) {
    h.update(f)
    h.update("\n")
    h.update(readFileSync(join(root, "src", f), "utf8"))
  }
  return h.digest("hex")
}

// ---- main -------------------------------------------------------------------
function main() {
  rmSync(CORPUS_DIR, { recursive: true, force: true })
  mkdirSync(join(CORPUS_DIR, "src"), { recursive: true })

  const records = genCorpus()
  for (const r of records) writeFileSync(join(CORPUS_DIR, r.path), r.body)

  const gt = buildGroundTruth(records)
  const gtText = JSON.stringify(gt, null, 2) + "\n"
  writeFileSync(GT_PATH, gtText)

  const generatorSource = readFileSync(fileURLToPath(import.meta.url), "utf8")
  const manifest = {
    benchmark_id: "semantic-state-audit-v2-192",
    version: "v2-192",
    seed: SEED,
    counts: gt.counts,
    sha256: {
      generator: sha256(generatorSource),
      ground_truth: sha256(gtText),
      corpus_aggregate: corpusAggregateHash(CORPUS_DIR),
    },
    generated_file_count: records.length,
  }
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n")

  console.log(JSON.stringify({
    files: records.length,
    counts: gt.counts,
    aggregate: manifest.sha256.corpus_aggregate,
    gt: manifest.sha256.ground_truth,
  }, null, 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
