#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { parseArgs } from "./lib.mjs"
import { compareSemanticStateAuditSuite } from "./suite-lib.mjs"

const args = parseArgs(process.argv.slice(2), ["192-normal", "192-rlm", "384-normal", "384-rlm", "out"])
const [normal192, rlm192, normal384, rlm384] = await Promise.all([
  readFile(args["192-normal"], "utf8").then(JSON.parse),
  readFile(args["192-rlm"], "utf8").then(JSON.parse),
  readFile(args["384-normal"], "utf8").then(JSON.parse),
  readFile(args["384-rlm"], "utf8").then(JSON.parse),
])

const suite = compareSemanticStateAuditSuite({ normal192, rlm192, normal384, rlm384 })
await mkdir(dirname(args.out), { recursive: true })
await writeFile(args.out, JSON.stringify(suite, null, 2) + "\n")
console.log(`${suite.suite_id}: source=${suite.source_commit} model=${suite.model.provider_id}/${suite.model.model_id}${suite.model.variant ? `/${suite.model.variant}` : ""}`)
