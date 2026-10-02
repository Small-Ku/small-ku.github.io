import assert from "node:assert/strict";
import test from "node:test";
import { compileResidualCjkPunctuationOpportunities, filterResidualCjkPunctuationOpportunities } from "../src/lib/editorial-punctuation.ts";

const points = (...offsets) => offsets.map(offset => ({ offset, kind: "punctuation" }));
const residualCjkPunctuationOpportunities = (text, points, start, end, halts) =>
  filterResidualCjkPunctuationOpportunities(compileResidualCjkPunctuationOpportunities(text, points), start, end, halts);

test("an ambiguous quote owns one budget despite both boundary candidates", () => {
  assert.deepEqual(residualCjkPunctuationOpportunities('甲"乙丙丁戊己', points(1, 2, 2), 0, 7), [
    { glyphStart: 1, glyphEnd: 2, offset: 2, direction: "opening", ambiguous: true }
  ]);
});

test("paired ASCII quotes compress toward their enclosed text", () => {
  const owners = residualCjkPunctuationOpportunities('甲"乙"丙', points(1, 2, 3, 4), 0, 5);
  assert.deepEqual(owners.map(({ glyphStart, offset, direction }) => ({ glyphStart, offset, direction })), [
    { glyphStart: 1, offset: 2, direction: "opening" },
    { glyphStart: 3, offset: 3, direction: "closing" }
  ]);
});

test("line slicing does not turn a closing quote into an opening quote", () => {
  assert.deepEqual(residualCjkPunctuationOpportunities('甲"乙"丙', points(1, 2, 3, 4), 2, 5), [
    { glyphStart: 3, glyphEnd: 4, offset: 3, direction: "closing", ambiguous: true }
  ]);
});

test("unambiguous punctuation retains its existing directional boundaries", () => {
  assert.deepEqual(residualCjkPunctuationOpportunities("甲，乙（丙）丁", points(1, 4, 5), 0, 7), [
    { glyphStart: 1, glyphEnd: 2, offset: 1, direction: "closing", ambiguous: false },
    { glyphStart: 3, glyphEnd: 4, offset: 4, direction: "opening", ambiguous: false },
    { glyphStart: 5, glyphEnd: 6, offset: 5, direction: "closing", ambiguous: false }
  ]);
});

test("native punctuation clusters remain excluded from residual compression", () => {
  for (const text of ['甲，，乙', '甲""乙', "甲（）乙"]) {
    assert.deepEqual(residualCjkPunctuationOpportunities(text, points(1, 2, 3), 0, 4), []);
  }
});

test("halt excludes its owning glyph rather than creating another manual budget", () => {
  assert.deepEqual(residualCjkPunctuationOpportunities("甲，乙", points(1), 0, 3, [{ start: 1, end: 2 }]), []);
});

test("ownership uses canonical UTF-16 offsets across astral Han", () => {
  assert.deepEqual(residualCjkPunctuationOpportunities('𠮷"乙', points(2, 3), 0, 4), [
    { glyphStart: 2, glyphEnd: 3, offset: 3, direction: "opening", ambiguous: true }
  ]);
});

test("one compiled table preserves quote direction across every line slice", () => {
  const text = '甲"乙"丙', boundaries = points(1, 2, 3, 4);
  const compiled = compileResidualCjkPunctuationOpportunities(text, boundaries);
  assert.equal(compiled.length, 2);
  for (let start = 0; start <= text.length; start++) for (let end = start; end <= text.length; end++) {
    const expected = [];
    if (start <= 1 && end > 2) expected.push(compiled[0]);
    if (start < 3 && end >= 4) expected.push(compiled[1]);
    assert.deepEqual(filterResidualCjkPunctuationOpportunities(compiled, start, end), expected);
  }
  assert.equal(compiled[1].direction, "closing");
});

test("repeated halt filtering excludes only the owning glyph without changing the compiled table", () => {
  const compiled = compileResidualCjkPunctuationOpportunities('甲"乙"丙，丁', points(1, 2, 3, 4, 5));
  const original = structuredClone(compiled);
  assert.equal(compiled.length, 3);
  const ranges = [
    [{ start: 1, end: 2 }],
    [{ start: 3, end: 4 }],
    [{ start: 5, end: 6 }],
    [{ start: 2, end: 3 }],
    [{ start: 1, end: 2 }, { start: 5, end: 6 }]
  ];
  for (const halts of ranges) {
    const owned = new Set(halts.map(halt => halt.start));
    assert.deepEqual(filterResidualCjkPunctuationOpportunities(compiled, 0, 7, halts),
      original.filter(point => !owned.has(point.glyphStart)));
  }
  assert.deepEqual(compiled, original);
  assert.deepEqual(filterResidualCjkPunctuationOpportunities(compiled, 0, 7), original);
});
