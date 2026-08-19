#!/usr/bin/env node
/**
 * RLM benchmark — deterministic semantic-state-audit corpus generator.
 *
 * Single source of truth: given a fixed seed this script deterministically
 * (re)generates the full corpus and its ground truth. Re-running after
 * deleting generated outputs produces byte-identical files.
 *
 * Semantic invariant:
 *   VIOLATION: business/domain/UI RESULT state is changed before a successful
 *     awaited async backend/worker operation completes.
 *   DECOY:     similar-looking but correct code — lifecycle/in-flight state
 *     (loading/busy/pending/syncing) before await, or result state changed
 *     only AFTER a successful await, or local-only mutation with no backend.
 *   NEUTRAL:   code without any backend/worker operation or any async
 *     result-state mutation (pure local state, formatting, helpers).
 *
 * No file names or comments reveal the class of a case.
 */

import { createHash } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync, readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const ROOT = join(__dirname, "..")

const SEED = 20260815
const CORPUS_DIR = join(ROOT, "corpora", "semantic-state-audit-v1")
const GT_PATH = join(ROOT, "ground-truth", "semantic-state-audit-v1.json")
const MANIFEST_PATH = join(ROOT, "manifests", "semantic-state-audit-v1.json")

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

// ---- template library ------------------------------------------------------
// Each template is a function (fields) => array-of-lines. Templates are
// semantically distinct; all names are neutral UI/domain identifiers.
// Marker tokens like __STATE__, __FIELD__, __OP__, __VALUE__ are substituted
// with neutral names selected from per-class name pools.

const NAME_POOL = [
  "panel", "view", "store", "grid", "tray", "flow", "stage", "zone", "board",
  "ticker", "meter", "cache", "ledger", "queue", "feed", "rollup", "sink",
  "registry", "banner", "badge", "dock", "sheet", "deck", "bundle", "slot",
]

const FIELD_RESULT = [
  "results", "items", "entries", "records", "rows", "output", "total",
  "balance", "value", "count", "payload", "list", "report", "summary",
]

const FIELD_LIFECYCLE = [
  "loading", "busy", "pending", "syncing", "refreshing", "saving",
  "uploading", "processing", "starting", "submitting",
]

const OP_KINDS = [
  { backend: "backend", verb: "command", nouns: ["submit", "apply", "commit", "execute", "publish", "persist", "sync", "process"] },
  { backend: "worker", verb: "command", nouns: ["fetch", "load", "refresh", "pull", "send", "push", "finalize", "stage"] },
]

const BACKEND_LINES = (backend) => [
  `import { ${backend} } from "./api"`,
  "",
  `export class ${cap(backend)}ClientAdapter {`,
  `  private static instance: ${cap(backend)}ClientAdapter`,
  "",
  `  static get() {`,
  `    if (!${cap(backend)}ClientAdapter.instance) {`,
  `      ${cap(backend)}ClientAdapter.instance = new ${cap(backend)}ClientAdapter()`,
  `    }`,
  `    return ${cap(backend)}ClientAdapter.instance`,
  `  }`,
  `}`,
  "",
]

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** A awaited backend/worker op line, e.g. `const result = await backend.command({...})`. */
function awaitLine(backend, verb, noun) {
  return `const result = await ${backend}.${verb}({ key: "${noun}", draft: "" })`
}

// VIOLATION templates: result state mutated before await.
const VIOLATION_TEMPLATES = [
  // (1) assign result array before await, then mutate after success
  (f) => [
    `import { ${f.backend} } from "./api"`,
    "",
    `export class ${f.Cls}Controller {`,
    `  ${f.state} = [] as string[]`,
    "",
    `  async ${f.method}() {`,
    `    this.${f.state} = this.${f.state}.concat(["draft-${f.verb}"])`,
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
  // (3) object/record field mutated before await
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
  // (4) Set/collection mutated before await
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
  // (5) boolean result flag set before await
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

// DECOY templates: correct patterns.
const DECOY_TEMPLATES = [
  // (7) lifecycle flag before await, then reset — correct
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
  // (9) lifecycle loading map before await, then replace — correct
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
  // (10) pending counter before await (lifecycle) — correct
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
  // (11) local-only mutation, then backend, no result coupling — correct
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
  // (12) lifecycle syncing flag set before await — correct
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
  // (13) result state replaced after await with then-style — correct
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
]

// NEUTRAL templates: no backend operation / pure local.
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

// Shared async backend/worker API. Part of the neutral set (backend/mock
// implementation code without a corresponding domain/UI result-state mutation).
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
function generateCase(index, cls, template, rng, backendPool) {
  const word = (pool) => pool[Math.floor(rng() * pool.length)]
  const name = NAME_POOL[index % NAME_POOL.length]
  const Cls = cap(name) + cap(String(index + 1).padStart(2, "0"))
  const method = "handle" + cap(word(["request", "change", "action", "update", "event"]))
  const backendEntry = backendPool[index % backendPool.length]
  const f = {
    Cls,
    method,
    backend: backendEntry.backend,
    verb: backendEntry.verb,
    noun: word(backendEntry.nouns),
    state: cls === "violation" || cls === "decoy" ? word(FIELD_RESULT) : word(FIELD_RESULT),
  }
  // lifecycle decoys use lifecycle field names for their lifecycle state
  if (cls === "decoy" && template === DECOY_TEMPLATES[0]) f.state = word(FIELD_LIFECYCLE)
  if (cls === "decoy" && template === DECOY_TEMPLATES[3]) f.state = word(FIELD_LIFECYCLE)
  if (cls === "decoy" && template === DECOY_TEMPLATES[5]) f.state = word(FIELD_LIFECYCLE)
  const body = template(f).join("\n")
  const subtype = templateSubtype(cls, template)
  return { body, f, subtype }
}

function templateSubtype(cls, template) {
  if (cls === "violation") return VIOLATION_TEMPLATES.indexOf(template) + 1
  if (cls === "decoy") return 100 + DECOY_TEMPLATES.indexOf(template)
  return 200 + NEUTRAL_TEMPLATES.indexOf(template)
}

function genCorpus() {
  const rng = mulberry32(SEED)
  const backendPool = OP_KINDS

  // Build a deterministic case list with the exact required counts.
  const cases = []
  // 12 violations: cycle through 6 violation templates x2
  for (let i = 0; i < 12; i++) {
    const t = VIOLATION_TEMPLATES[i % VIOLATION_TEMPLATES.length]
    cases.push({ cls: "violation", template: t, rng, backendPool })
  }
  // 36 decoys: cycle through 7 decoy templates (7*5=35 +1)
  for (let i = 0; i < 36; i++) {
    const t = DECOY_TEMPLATES[i % DECOY_TEMPLATES.length]
    cases.push({ cls: "decoy", template: t, rng, backendPool })
  }
  // 47 neutral template cases + src/api.ts (neutral, backend-support) = 48
  for (let i = 0; i < 47; i++) {
    const t = NEUTRAL_TEMPLATES[i % NEUTRAL_TEMPLATES.length]
    cases.push({ cls: "neutral", template: t, rng, backendPool })
  }
  // Deterministic shuffle so class is not revealed by file position/name.
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
      const suffix = String(Math.floor(rng() * 9000) + 1000)
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
    const g = generateCase(i, spec.cls, spec.template, spec.rng, spec.backendPool)
    records.push({ path: `src/${name}`, cls: spec.cls, subtype: g.subtype, ...g.f, body: g.body })
  }
  // src/api.ts is part of the neutral set: backend/mock implementation code
  // without a corresponding domain/UI result-state mutation.
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
  const violations = records
    .filter((r) => r.cls === "violation")
    .map((r) => ({
      path: r.path,
      class: "violation",
      scenario_subtype: `violation-${r.subtype}`,
      state_field: r.state,
      async_operation: `${r.backend}.${r.verb}`,
      reason: `observable result state "${r.state}" is mutated before the awaited ${r.backend}.${r.verb}() completes`,
    }))
  const decoys = records
    .filter((r) => r.cls === "decoy")
    .map((r) => ({
      path: r.path,
      class: "decoy",
      scenario_subtype: `decoy-${r.subtype}`,
      state_field: r.state,
      async_operation: `${r.backend}.${r.verb}`,
      reason: `not a violation: lifecycle/local state or result updated only after successful completion`,
    }))
  const neutrals = records
    .filter((r) => r.cls === "neutral")
    .map((r) => ({
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
    benchmark: "semantic-state-audit-v1",
    seed: SEED,
    invariant: "business/domain/UI result state changed before successful awaited async backend/worker completion",
    cases: [...violations, ...decoys, ...neutrals],
    expected_violation_paths: violations.map((v) => v.path),
    counts: { violation: violations.length, decoy: decoys.length, neutral: neutrals.length, total: records.length },
  }
}

// ---- hashing ---------------------------------------------------------------
function sha256(text) {
  return createHash("sha256").update(text).digest("hex")
}

function corpusAggregateHash(root) {
  const files = readdirSync(join(root, "src")).filter((f) => f.endsWith(".ts")).sort()
  const h = createHash("sha256")
  for (const f of files) {
    h.update(f)
    h.update("\n")
    h.update(readFileOf(root, f))
  }
  return h.digest("hex")
}

function readFileOf(root, name) {
  return readFileSync(join(root, "src", name), "utf8")
}

// ---- main -------------------------------------------------------------------
function main() {
  rmSync(CORPUS_DIR, { recursive: true, force: true })
  mkdirSync(join(CORPUS_DIR, "src"), { recursive: true })

  const records = genCorpus()
  for (const r of records) {
    writeFileSync(join(CORPUS_DIR, r.path), r.body)
  }

  const gt = buildGroundTruth(records)
  writeFileSync(GT_PATH, JSON.stringify(gt, null, 2) + "\n")

  // Manifest.
  const generatorSource = readFileOf2(new URL(import.meta.url))
  const gtText = JSON.stringify(gt, null, 2) + "\n"
  const manifest = {
    benchmark_id: "semantic-state-audit-v1",
    version: "v1",
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

  console.log(
    JSON.stringify(
      {
        files: records.length,
        counts: gt.counts,
        aggregate: manifest.sha256.corpus_aggregate,
        gt: manifest.sha256.ground_truth,
      },
      null,
      2,
    ),
  )
}

function readFileOf2(fileUrl) {
  return readFileSync(fileURLToPath(fileUrl), "utf8")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
