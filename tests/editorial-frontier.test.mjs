import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the private frontier with real production comparators/dominance.
// The reference replaces only ordered insertion with the former stable sort.
const solver = fs.readFileSync(new URL("../src/scripts/editorial-composer-solver.ts", import.meta.url), "utf8");
const helpers = solver.slice(solver.indexOf("function semanticTier"), solver.indexOf("function solveAtTarget"));
const insertionStart = helpers.indexOf("  if (!Number.isFinite(compositionPenalty(state))");
const insertionEnd = helpers.indexOf("\ninterface SolveResult", insertionStart);
assert.ok(insertionStart >= 0 && insertionEnd > insertionStart, "locate frontier insertion for the stable-sort reference");
const reference = helpers.slice(0, insertionStart) + `  bucket.push(state);
  bucket.sort(preserveShape ? compareShapePartial : compare);
  bucket.length = Math.min(bucket.length, limit);
}
` + helpers.slice(insertionEnd);
function load(source) {
  return vm.runInNewContext(ts.transpileModule(source + "\nparetoInsert", {
    compilerOptions: { target: ts.ScriptTarget.ESNext }
  }).outputText);
}
const insert = load(helpers), sort = load(reference);
function state(id, values = {}) {
  const widths = values.widths ?? [90];
  return {
    id, lines: widths.map(finalOpticalWidthPx => ({ finalOpticalWidthPx })),
    widthCount: widths.length, widthSum: widths.reduce((a, b) => a + b, 0),
    widthMin: Math.min(...widths), widthMax: Math.max(...widths),
    maxUtil: 0, totalResidual: 0, totalFitPenalty: 0, semantic: 0,
    unsafeBreaks: 0, artDirectedBreaks: 0, hyphens: 0, finalShort: 0, ...values
  };
}
function check(states, shape, limit) {
  const actual = [], expected = [];
  for (const value of states) {
    sort(expected, value, shape, limit);
    insert(actual, value, shape, limit);
    assert.deepEqual(actual.map(value => value.id), expected.map(value => value.id));
  }
}

test("ordered insertion preserves every intermediate capped frontier in exhaustive short streams", () => {
  const pool = [];
  for (const semantic of [-8, 0]) for (const totalFitPenalty of [0, 1]) {
    for (const maxUtil of [0, 0.5]) for (const widths of [[80], [100, 80]]) {
      pool.push(state(pool.length, { semantic, totalFitPenalty, maxUtil, widths }));
    }
  }
  for (const shape of [false, true]) for (const limit of [1, 2, 4]) {
    for (const a of pool) for (const b of pool) for (const c of pool) check([a, b, c], shape, limit);
  }
});

test("ordered insertion preserves full frontiers, tolerance boundaries, and non-finite fallback", () => {
  let seed = 323402;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const shape of [false, true]) for (const limit of [32, 64]) {
    for (let stream = 0; stream < 10; stream += 1) {
      check(Array.from({ length: 500 }, (_, id) => state(id, {
        widths: Array.from({ length: 1 + Math.floor(random() * 8) }, () => 20 + random() * 200),
        totalFitPenalty: random() * 5, semantic: Math.floor(random() * 32) - 16,
        maxUtil: random(), totalResidual: random() * 20, finalShort: random() * 50,
        unsafeBreaks: Math.floor(random() * 3), artDirectedBreaks: Math.floor(random() * 3),
        hyphens: Math.floor(random() * 4)
      })), shape, limit);
    }
    for (const key of ["semantic", "maxUtil", "totalResidual", "finalShort", "widthSum", "widthMin", "widthMax", "widthCount", "unsafeBreaks", "artDirectedBreaks", "hyphens"]) {
      check(Array.from({ length: 100 }, (_, id) => state(id, {
        [key]: id % 7 === 0 ? NaN : id % 11 === 0 ? Infinity : 0,
        totalFitPenalty: random() * 4
      })), shape, limit);
    }
  }
  check(Array.from({ length: 100 }, (_, id) => state(id, {
    widths: [80, 100], totalFitPenalty: id * 0.00001
  })), true, 64);
});
