#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const REFERENCE_RESOURCE_ENVELOPE = Object.freeze({
  memoryMaxBytes: 1536 * 1024 * 1024,
  swapMaxBytes: 0,
  cpuQuotaCpus: 2,
  pidsMax: 64,
})

function decodeMountField(value) {
  return value.replace(/\\([0-7]{3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
}

export function parseUnifiedCgroup(text) {
  for (const raw of String(text).split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const match = /^0::(\/.*)$/.exec(line)
    if (match) return path.posix.normalize(match[1])
  }
  throw new Error("process is not attached to a cgroup v2 unified hierarchy")
}

export function parseCgroup2Mounts(text) {
  const mounts = []
  for (const raw of String(text).split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const separator = line.indexOf(" - ")
    if (separator < 0) continue
    const left = line.slice(0, separator).split(" ")
    const right = line.slice(separator + 3).split(" ")
    if (right[0] !== "cgroup2" || left.length < 5) continue
    mounts.push({
      root: path.posix.normalize(decodeMountField(left[3])),
      mountPoint: decodeMountField(left[4]),
    })
  }
  if (mounts.length === 0) throw new Error("no cgroup v2 mount found in mountinfo")
  return mounts
}

export function resolveCgroupDirectory(mounts, cgroupPath) {
  const normalized = path.posix.normalize(cgroupPath)
  const candidates = mounts
    .filter(({ root }) => root === "/" || normalized === root || normalized.startsWith(`${root}/`))
    .sort((a, b) => b.root.length - a.root.length)
  const selected = candidates[0]
  if (!selected) throw new Error(`no cgroup v2 mount covers ${normalized}`)
  const relative = selected.root === "/"
    ? normalized.replace(/^\/+/, "")
    : normalized.slice(selected.root.length).replace(/^\/+/, "")
  const mountPoint = path.resolve(selected.mountPoint)
  const resolved = path.resolve(mountPoint, relative)
  if (resolved !== mountPoint && !resolved.startsWith(`${mountPoint}${path.sep}`)) {
    throw new Error(`resolved cgroup path escapes mount point: ${resolved}`)
  }
  return resolved
}

function parseFiniteControl(name, raw) {
  const value = String(raw).trim()
  if (value === "max") return { raw: value, value: Infinity }
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} contains invalid value ${JSON.stringify(value)}`)
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error(`${name} is outside the safe integer range`)
  return { raw: value, value: numeric }
}

function parseCpuMax(raw) {
  const fields = String(raw).trim().split(/\s+/)
  if (fields.length !== 2) throw new Error(`cpu.max must contain quota and period, got ${JSON.stringify(String(raw).trim())}`)
  if (fields[0] === "max") return { raw: String(raw).trim(), quota: Infinity, period: Number(fields[1]), cpus: Infinity }
  if (!/^[0-9]+$/.test(fields[0]) || !/^[0-9]+$/.test(fields[1])) {
    throw new Error(`cpu.max contains invalid numeric fields: ${JSON.stringify(String(raw).trim())}`)
  }
  const quota = Number(fields[0])
  const period = Number(fields[1])
  if (!Number.isSafeInteger(quota) || quota <= 0 || !Number.isSafeInteger(period) || period <= 0) {
    throw new Error(`cpu.max quota/period must be positive safe integers`)
  }
  return { raw: String(raw).trim(), quota, period, cpus: quota / period }
}

function cgroupContains(rootCgroup, candidate) {
  const root = path.posix.normalize(rootCgroup)
  const child = path.posix.normalize(candidate)
  return root === "/" || child === root || child.startsWith(`${root}/`)
}

async function readProcessParent(procRoot, pid) {
  try {
    const status = await readFile(path.join(procRoot, String(pid), "status"), "utf8")
    const line = status.split("\n").find((entry) => entry.startsWith("PPid:"))
    if (!line) return null
    const value = Number(line.slice(5).trim())
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ESRCH") return null
    throw error
  }
}

async function readProcessCgroup(procRoot, pid) {
  try {
    return parseUnifiedCgroup(await readFile(path.join(procRoot, String(pid), "cgroup"), "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ESRCH") return null
    throw error
  }
}

export async function collectProcessTree(procRoot, rootPid) {
  const names = await readdir(procRoot)
  const pids = names.filter((name) => /^[0-9]+$/.test(name)).map(Number)
  const children = new Map()
  for (const pid of pids) {
    const parent = await readProcessParent(procRoot, pid)
    if (parent === null) continue
    const list = children.get(parent) ?? []
    list.push(pid)
    children.set(parent, list)
  }

  const result = []
  const seen = new Set()
  const queue = [rootPid]
  while (queue.length > 0) {
    const pid = queue.shift()
    if (seen.has(pid)) continue
    seen.add(pid)
    result.push(pid)
    for (const child of children.get(pid) ?? []) queue.push(child)
  }
  return result
}

function check(name, actual, expected, ok) {
  return { name, ok: Boolean(ok), actual, expected }
}

async function readOptional(file) {
  try {
    return (await readFile(file, "utf8")).trim()
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

export async function inspectResourceEnvelope({
  rootPid,
  procRoot = "/proc",
  mountInfoPath = path.join(procRoot, "self", "mountinfo"),
  expected = REFERENCE_RESOURCE_ENVELOPE,
} = {}) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) throw new Error("rootPid must be a positive integer")

  const rootCgroup = await readProcessCgroup(procRoot, rootPid)
  if (!rootCgroup) throw new Error(`root process ${rootPid} disappeared before its cgroup could be read`)
  const mounts = parseCgroup2Mounts(await readFile(mountInfoPath, "utf8"))
  const cgroupDirectory = resolveCgroupDirectory(mounts, rootCgroup)

  const [memoryRaw, swapRaw, cpuRaw, pidsRaw, pidsCurrentRaw, memoryCurrentRaw] = await Promise.all([
    readFile(path.join(cgroupDirectory, "memory.max"), "utf8"),
    readFile(path.join(cgroupDirectory, "memory.swap.max"), "utf8"),
    readFile(path.join(cgroupDirectory, "cpu.max"), "utf8"),
    readFile(path.join(cgroupDirectory, "pids.max"), "utf8"),
    readOptional(path.join(cgroupDirectory, "pids.current")),
    readOptional(path.join(cgroupDirectory, "memory.current")),
  ])

  const memory = parseFiniteControl("memory.max", memoryRaw)
  const swap = parseFiniteControl("memory.swap.max", swapRaw)
  const cpu = parseCpuMax(cpuRaw)
  const pidsMax = parseFiniteControl("pids.max", pidsRaw)
  const pidsCurrent = pidsCurrentRaw === null ? null : parseFiniteControl("pids.current", pidsCurrentRaw).value
  const memoryCurrent = memoryCurrentRaw === null ? null : parseFiniteControl("memory.current", memoryCurrentRaw).value

  const tree = await collectProcessTree(procRoot, rootPid)
  const processCgroups = []
  for (const pid of tree) {
    const cgroup = await readProcessCgroup(procRoot, pid)
    if (cgroup !== null) processCgroups.push({ pid, cgroup, covered: cgroupContains(rootCgroup, cgroup) })
  }
  const uncovered = processCgroups.filter((entry) => !entry.covered)

  const checks = [
    check("memory.max", memory.value, expected.memoryMaxBytes, memory.value === expected.memoryMaxBytes),
    check("memory.swap.max", swap.value, expected.swapMaxBytes, swap.value === expected.swapMaxBytes),
    check("cpu.max", cpu.cpus, expected.cpuQuotaCpus, Number.isFinite(cpu.cpus) && cpu.cpus === expected.cpuQuotaCpus),
    check("pids.max", pidsMax.value, expected.pidsMax, pidsMax.value === expected.pidsMax),
    check("process-tree-cgroup-coverage", uncovered.map(({ pid, cgroup }) => ({ pid, cgroup })), [], uncovered.length === 0),
  ]
  if (pidsCurrent !== null) {
    checks.push(check("pids.current<=pids.max", pidsCurrent, pidsMax.value, pidsCurrent <= pidsMax.value))
  }
  if (memoryCurrent !== null) {
    checks.push(check("memory.current<=memory.max", memoryCurrent, memory.value, memoryCurrent <= memory.value))
  }

  return {
    schema_version: 1,
    kind: "rlm_resource_envelope_evidence",
    captured_at: new Date().toISOString(),
    root_pid: rootPid,
    root_cgroup: rootCgroup,
    cgroup_directory: cgroupDirectory,
    controls: {
      memory_max: memory.raw,
      memory_current: memoryCurrentRaw,
      memory_swap_max: swap.raw,
      cpu_max: cpu.raw,
      pids_max: pidsMax.raw,
      pids_current: pidsCurrentRaw,
    },
    process_tree: processCgroups,
    checks,
    ok: checks.every((entry) => entry.ok),
  }
}

function parseCli(argv) {
  let rootPid = null
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--root-pid") {
      rootPid = Number(argv[++index])
      continue
    }
    if (arg === "--help" || arg === "-h") return { help: true }
    throw new Error(`unknown argument: ${arg}`)
  }
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) {
    throw new Error("--root-pid <pid> is required")
  }
  return { rootPid }
}

async function main() {
  try {
    const args = parseCli(process.argv.slice(2))
    if (args.help) {
      process.stdout.write("Usage: node scripts/verify-resource-envelope.mjs --root-pid <service-root-pid>\n")
      return
    }
    const report = await inspectResourceEnvelope({ rootPid: args.rootPid })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ""
if (invokedPath === import.meta.url) await main()
