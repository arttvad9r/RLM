function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function codeUnitSort(values) {
  return [...values].sort((a, b) => a === b ? 0 : a < b ? -1 : 1)
}

export function expectedCorpusNames(groundTruth) {
  invariant(groundTruth !== null && typeof groundTruth === "object" && !Array.isArray(groundTruth), "ground truth must be an object")
  invariant(Array.isArray(groundTruth.cases) && groundTruth.cases.length > 0, "ground truth cases must be a non-empty array")
  const names = []
  const seen = new Set()
  for (const entry of groundTruth.cases) {
    invariant(entry !== null && typeof entry === "object" && !Array.isArray(entry), "ground truth case must be an object")
    invariant(typeof entry.path === "string" && entry.path.startsWith("src/"), `ground truth case must be an immediate src path: ${String(entry.path)}`)
    const name = entry.path.slice(4)
    invariant(name.length > 0 && !name.includes("/") && name.endsWith(".ts"), `ground truth case must map to one src/*.ts file: ${entry.path}`)
    invariant(!seen.has(name), `duplicate ground truth corpus name: ${name}`)
    seen.add(name)
    names.push(name)
  }
  return codeUnitSort(names)
}

export function assertCorpusNamesMatchGroundTruth(groundTruth, actualNames) {
  invariant(Array.isArray(actualNames), "corpus names must be an array")
  const seen = new Set()
  for (const name of actualNames) {
    invariant(typeof name === "string" && name.length > 0, "corpus names must be non-empty strings")
    invariant(!seen.has(name), `duplicate corpus file name: ${name}`)
    seen.add(name)
  }
  const expected = expectedCorpusNames(groundTruth)
  const actual = codeUnitSort(actualNames)
  invariant(actual.length === expected.length, `corpus file count does not match ground truth: expected ${expected.length}, got ${actual.length}`)
  for (let i = 0; i < expected.length; i++) {
    invariant(actual[i] === expected[i], `corpus file set does not match ground truth: expected ${expected[i]}, got ${actual[i] ?? "<missing>"}`)
  }
}
