import assert from "node:assert/strict"
import test from "node:test"
import { assertCorpusNamesMatchGroundTruth, expectedCorpusNames } from "./corpus-layout.mjs"
import { corpusAggregate } from "./lib.mjs"

test("corpus layout matches the exact ground-truth src file set independent of input order", () => {
  const groundTruth = { cases: [{ path: "src/Z.ts" }, { path: "src/a.ts" }, { path: "src/A.ts" }] }
  assert.deepEqual(expectedCorpusNames(groundTruth), ["A.ts", "Z.ts", "a.ts"])
  assert.doesNotThrow(() => assertCorpusNamesMatchGroundTruth(groundTruth, ["a.ts", "A.ts", "Z.ts"]))
})

test("layout binding closes legacy aggregate boundary collisions", () => {
  const corpusA = [{ name: "a.ts", content: "Xb" }, { name: "c.ts", content: "D" }]
  const corpusB = [{ name: "a.ts", content: "X" }, { name: "bc.ts", content: "D" }]
  assert.equal(corpusAggregate(corpusA), corpusAggregate(corpusB), "fixture must demonstrate the legacy aggregate ambiguity")

  const groundTruth = { cases: [{ path: "src/a.ts" }, { path: "src/c.ts" }] }
  assert.doesNotThrow(() => assertCorpusNamesMatchGroundTruth(groundTruth, corpusA.map((entry) => entry.name)))
  assert.throws(
    () => assertCorpusNamesMatchGroundTruth(groundTruth, corpusB.map((entry) => entry.name)),
    /corpus file set does not match ground truth/,
  )
})

test("corpus layout rejects count drift, duplicate names and nested/non-ts ground-truth paths", () => {
  const groundTruth = { cases: [{ path: "src/a.ts" }, { path: "src/b.ts" }] }
  assert.throws(() => assertCorpusNamesMatchGroundTruth(groundTruth, ["a.ts"]), /corpus file count does not match ground truth/)
  assert.throws(() => assertCorpusNamesMatchGroundTruth(groundTruth, ["a.ts", "a.ts"]), /duplicate corpus file name/)
  assert.throws(() => expectedCorpusNames({ cases: [{ path: "src/nested/a.ts" }] }), /map to one src\/\*\.ts file/)
  assert.throws(() => expectedCorpusNames({ cases: [{ path: "src/a.js" }] }), /map to one src\/\*\.ts file/)
})
