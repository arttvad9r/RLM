import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  REFERENCE_RESOURCE_ENVELOPE,
  inspectResourceEnvelope,
  parseUnifiedCgroup,
  resolveCgroupDirectory,
} from "../../scripts/verify-resource-envelope.mjs"

async function writeProcess(procRoot, pid, ppid, cgroup) {
  const dir = path.join(procRoot, String(pid))
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "status"), `Name:\ttest-${pid}\nPid:\t${pid}\nPPid:\t${ppid}\n`)
  await writeFile(path.join(dir, "cgroup"), `0::${cgroup}\n`)
}

async function fixture({ controls = {}, escapedChild = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-resource-envelope-"))
  const procRoot = path.join(root, "proc")
  const cgroupMount = path.join(root, "cgroup")
  const selfDir = path.join(procRoot, "self")
  await mkdir(selfDir, { recursive: true })
  await mkdir(cgroupMount, { recursive: true })

  const serviceCgroup = "/system.slice/opencode-rlm.service"
  const serviceDir = path.join(cgroupMount, "opencode-rlm.service")
  await mkdir(serviceDir, { recursive: true })

  await writeFile(
    path.join(selfDir, "mountinfo"),
    `29 23 0:26 /system.slice ${cgroupMount} rw,nosuid,nodev,noexec,relatime - cgroup2 cgroup rw\n`,
  )
  await writeProcess(procRoot, 100, 1, serviceCgroup)
  await writeProcess(procRoot, 101, 100, escapedChild ? "/other.slice/escape.service" : serviceCgroup)
  await writeProcess(procRoot, 102, 101, `${serviceCgroup}/rlm-child`)
  await writeProcess(procRoot, 200, 1, "/unrelated.service")

  const defaults = {
    "memory.max": String(REFERENCE_RESOURCE_ENVELOPE.memoryMaxBytes),
    "memory.swap.max": "0",
    "cpu.max": "200000 100000",
    "pids.max": "64",
    "pids.current": "4",
    "memory.current": "1048576",
  }
  for (const [name, value] of Object.entries({ ...defaults, ...controls })) {
    await writeFile(path.join(serviceDir, name), `${value}\n`)
  }

  return {
    root,
    procRoot,
    cgroupMount,
    mountInfoPath: path.join(selfDir, "mountinfo"),
    serviceCgroup,
  }
}

test("resource envelope verifier records exact reference controls and covered process tree", async () => {
  const f = await fixture()
  try {
    const report = await inspectResourceEnvelope({
      rootPid: 100,
      procRoot: f.procRoot,
      mountInfoPath: f.mountInfoPath,
    })
    assert.equal(report.ok, true)
    assert.equal(report.root_cgroup, f.serviceCgroup)
    assert.equal(report.cgroup_directory, path.join(f.cgroupMount, "opencode-rlm.service"))
    assert.deepEqual(report.process_tree.map((entry) => entry.pid), [100, 101, 102])
    assert.equal(report.process_tree.every((entry) => entry.covered), true)
    assert.equal(report.controls.memory_max, String(1536 * 1024 * 1024))
    assert.equal(report.controls.memory_swap_max, "0")
    assert.equal(report.controls.cpu_max, "200000 100000")
    assert.equal(report.controls.pids_max, "64")
    assert.equal(report.checks.every((entry) => entry.ok), true)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("resource envelope verifier fails closed on unlimited controls and escaped descendants", async () => {
  const f = await fixture({
    escapedChild: true,
    controls: {
      "memory.max": "max",
      "memory.swap.max": "max",
      "cpu.max": "max 100000",
      "pids.max": "max",
    },
  })
  try {
    const report = await inspectResourceEnvelope({
      rootPid: 100,
      procRoot: f.procRoot,
      mountInfoPath: f.mountInfoPath,
    })
    assert.equal(report.ok, false)
    for (const name of ["memory.max", "memory.swap.max", "cpu.max", "pids.max", "process-tree-cgroup-coverage"]) {
      assert.equal(report.checks.find((entry) => entry.name === name)?.ok, false, `${name} must fail`)
    }
    assert.deepEqual(
      report.checks.find((entry) => entry.name === "process-tree-cgroup-coverage")?.actual,
      [{ pid: 101, cgroup: "/other.slice/escape.service" }],
    )
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("cgroup parsers reject non-v2 membership and prevent mount escape", () => {
  assert.throws(() => parseUnifiedCgroup("2:cpu:/legacy\n"), /cgroup v2/)
  assert.throws(
    () => resolveCgroupDirectory([{ root: "/delegated", mountPoint: "/safe/cgroup" }], "/other/path"),
    /no cgroup v2 mount covers/,
  )
})
