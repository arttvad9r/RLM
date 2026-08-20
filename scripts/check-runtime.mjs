#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

export const PINNED_NODE_VERSION = "24.19.0"
export const PINNED_DENO_VERSION = "2.9.5"
export const SUPPORTED_NODE_MAJOR = 24
export const SUPPORTED_DENO_MAJOR = 2

export function parseRuntimeVersion(value, label = "runtime") {
  const text = String(value ?? "").trim()
  const match = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?(?:\s|$)/.exec(text)
    ?? /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(text)
  if (!match) throw new Error(`could not parse ${label} version from ${JSON.stringify(text)}`)
  return {
    raw: `${match[1]}.${match[2]}.${match[3]}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function assertCompatibleRuntime({ nodeVersion, denoVersion, exact = false }) {
  const node = parseRuntimeVersion(nodeVersion, "Node.js")
  const deno = parseRuntimeVersion(denoVersion, "Deno")
  if (exact) {
    if (node.raw !== PINNED_NODE_VERSION) {
      throw new Error(`Node.js ${PINNED_NODE_VERSION} is required for the exact RLM gate; found ${node.raw}`)
    }
    if (deno.raw !== PINNED_DENO_VERSION) {
      throw new Error(`Deno ${PINNED_DENO_VERSION} is required for the exact RLM gate; found ${deno.raw}`)
    }
    return { node, deno }
  }
  if (node.major !== SUPPORTED_NODE_MAJOR) {
    throw new Error(`RLM local validation requires Node.js ${SUPPORTED_NODE_MAJOR}.x; found ${node.raw}`)
  }
  if (deno.major !== SUPPORTED_DENO_MAJOR) {
    throw new Error(`RLM local validation requires Deno ${SUPPORTED_DENO_MAJOR}.x; found ${deno.raw}`)
  }
  return { node, deno }
}

export function readDenoVersion() {
  const result = spawnSync("deno", ["--version"], { encoding: "utf8" })
  if (result.error?.code === "ENOENT") throw new Error("Deno is not installed or not available on PATH")
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`deno --version failed with status ${result.status}: ${(result.stderr || result.stdout || "").trim()}`)
  }
  const firstLine = String(result.stdout).split(/\r?\n/, 1)[0]
  return parseRuntimeVersion(firstLine, "Deno").raw
}

export function checkCurrentRuntime({ exact = false } = {}) {
  const versions = assertCompatibleRuntime({
    nodeVersion: process.versions.node,
    denoVersion: readDenoVersion(),
    exact,
  })
  return versions
}

function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => !["--exact", "--help", "-h"].includes(arg))) {
    throw new Error(`unknown argument: ${args.find((arg) => !["--exact", "--help", "-h"].includes(arg))}`)
  }
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write("Usage: node scripts/check-runtime.mjs [--exact]\n")
    return
  }
  const exact = args.includes("--exact")
  const { node, deno } = checkCurrentRuntime({ exact })
  process.stdout.write(`runtime check: OK (Node ${node.raw}, Deno ${deno.raw}${exact ? ", exact" : ""})\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ""
if (invokedPath === import.meta.url) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
