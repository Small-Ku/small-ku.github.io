import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const [debugPort = "9251", sitePort = "4351"] = process.argv.slice(2);
const output = path.resolve(".editorial-review/punctuation-fix");
fs.mkdirSync(output, { recursive: true });
const compilerSource = fs.readFileSync("src/lib/editorial-compiler.ts", "utf8")
  .replace('"./editorial-punctuation"', JSON.stringify(pathToFileURL(path.resolve("src/lib/editorial-punctuation.ts")).href));
const compilerFile = path.join(output, "compiler.mjs");
fs.writeFileSync(compilerFile, ts.transpileModule(compilerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext }
}).outputText);
const { compileEditorialText } = await import(pathToFileURL(compilerFile).href);

const page = (await fetch(`http://127.0.0.1:${debugPort}/json`).then(r => r.json())).find(p => p.type === "page");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const pending = new Map();
let serial = 0;
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data), task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};

function inspectAllocations(plan, em) {
  const totals = new Map();
  for (const line of plan.lines) for (const adjustment of line.adjustments) {
    if (adjustment.kind !== "punctuation") continue;
    assert.ok(Math.abs(adjustment.glyphs.reduce((sum, g) => sum + g.deltaPx, 0) - adjustment.deltaPx) < 1e-6);
    for (const glyph of adjustment.glyphs) {
      assert.ok(glyph.deltaPx <= 0, "compression goes toward text");
      assert.equal(glyph.offset, glyph.direction === "opening" ? glyph.glyphEnd : glyph.glyphStart);
      assert.ok(!line.punctuationHalts.some(h => glyph.glyphStart < h.end && glyph.glyphEnd > h.start), "no halt double count");
      const key = `${glyph.glyphStart}:${glyph.glyphEnd}`;
      totals.set(key, (totals.get(key) || 0) - glyph.deltaPx);
    }
  }
  for (const [glyph, compression] of totals) assert.ok(compression <= 0.5 * em + 1e-6, `${glyph} aggregate ${compression}px exceeds half em`);
  for (const line of plan.lines) for (const adjustment of line.adjustments) if (adjustment.kind === "punctuation") {
    assert.equal(adjustment.count, new Set(adjustment.glyphs.map(g => g.glyphStart)).size, "count unique glyphs");
  }
  return [...totals].map(([glyph, compressionPx]) => ({ glyph, compressionPx }));
}

const cases = [
  { name: "original 0.75em quote regression", text: '甲"乙丙丁戊己', end: 5, overflow: 24 },
  { name: "ASCII quote remains an active resource", text: '甲"乙丙丁戊己', end: 5, overflow: 8, positiveQuote: true },
  { name: "paired quotes retain separate glyph budgets", text: '甲"乙"丙丁戊己庚辛', end: 7, overflow: 16, paired: true },
  { name: "ordinary comma retains manual compression", text: "甲，乙丙丁戊己", end: 5, overflow: 8, halt: false, manual: 8 },
  { name: "selected halt excludes manual compression", text: "甲，乙丙丁戊己", end: 5, overflow: 16, selectedHalt: true },
  { name: "native punctuation cluster stays excluded", text: "甲，，乙丙丁戊己", end: 6, overflow: 8, cluster: true }
];
const results = [];
try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: `http://127.0.0.1:${sitePort}/zh/` });
  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 50));
    if (await evaluate('document.readyState === "complete"')) break;
  }
  await evaluate("(async()=>{await document.fonts.ready;return true})()");
  for (const fixture of cases) {
    const ir = compileEditorialText(fixture.text, "zh", "display", [{ afterText: fixture.text.slice(0, fixture.end) }]).ir;
    const result = await evaluate(`(${browserProbe.toString()})(${JSON.stringify(fixture)},${JSON.stringify(ir)})`);
    assert.ok(result.plan, fixture.name + ": a feasible plan must exist");
    assert.equal(result.canonical, fixture.text);
    result.aggregate = inspectAllocations(result.plan, result.em);
    // Independently sum rendered margins by their canonical boundary and compare
    // to the plan. This detects the old renderer's second, unowned margin.
    const expected = new Map();
    for (const line of result.plan.lines) for (const a of line.adjustments) if (a.kind === "punctuation") {
      for (const g of a.glyphs) expected.set(g.offset, (expected.get(g.offset) || 0) + g.deltaPx);
    }
    for (const margin of result.margins) if (ir.adjustments.some(p => p.offset === margin.offset && p.kind === "punctuation")) {
      assert.ok(Math.abs(margin.deltaPx - (expected.get(margin.offset) || 0)) < 0.001, "renderer must use only planned glyph-owned allocations");
    }
    for (const quote of result.quotes) assert.ok(!quote.bothNeighborsOverlap, "a quote must not squeeze both Han neighbors");
    if (fixture.name.startsWith("original")) assert.notEqual(result.plan.lines[0].end, 5, "the over-budget original break must be infeasible");
    if (fixture.positiveQuote) assert.ok(result.aggregate.some(g => g.glyph === "1:2" && g.compressionPx > 0), "do not disable ASCII quotes");
    if (fixture.paired) assert.deepEqual(result.aggregate.map(g => g.glyph).sort(), ["1:2", "3:4"]);
    if (fixture.manual) assert.ok(Math.abs(result.plan.lines[0].punctuationCompressionPx - fixture.manual) < 1e-6);
    if (fixture.selectedHalt) {
      assert.ok(result.plan.lines[0].punctuationHalts.length > 0);
      assert.equal(result.plan.lines[0].punctuationCompressionPx, 0);
    }
    if (fixture.cluster) assert.ok(result.aggregate.every(g => g.glyph !== "1:2" && g.glyph !== "2:3"));
    results.push({ ...fixture, ...result, pass: true });
  }
  // Recreate the original double-boundary allocation. Every individual margin
  // passes a half-em check, while the new aggregate invariant rejects it.
  const legacy = results[0].legacy;
  assert.ok(legacy.margins.every(m => Math.abs(m.deltaPx) <= 16));
  assert.ok(legacy.quote.bothNeighborsOverlap);
  assert.throws(() => inspectAllocations(legacy.plan, 32), /aggregate 24px exceeds half em/);
  results.push({ name: "legacy negative control caught beyond per-margin checks", pass: true, legacy });
  fs.writeFileSync(path.join(output, "quote-regression.json"), JSON.stringify({ passed: results.length, failed: 0, results }, null, 2));
  console.log(JSON.stringify({ passed: results.length, failed: 0, cases: results.map(r => ({ name: r.name, aggregate: r.aggregate, firstLine: r.plan?.lines[0].end })) }, null, 2));
} finally {
  socket.close();
  fs.rmSync(compilerFile, { force: true });
}

async function browserProbe(fixture, ir) {
  const { solveEditorialLayout } = await import("/src/scripts/editorial-composer-solver.ts");
  const { applyEditorialPlan, rememberEditorialCanonicalChildren } = await import("/src/scripts/editorial-composer-renderer.ts");
  const { measureEditorialInline } = await import("/src/scripts/editorial-composer-geometry.ts");
  const host = document.createElement("div"), root = document.createElement("span");
  host.lang = "zh-HK";
  host.style.cssText = "position:fixed;left:100px;top:100px;width:1000px;visibility:hidden;font-size:32px";
  root.className = "editorial-text";
  root.dataset.editorialRoot = "";
  root.dataset.editorialRole = "display";
  root.textContent = fixture.text;
  host.append(root);
  document.body.append(host);
  const natural = measureEditorialInline(root, fixture.text, ir, 0, fixture.end);
  const target = natural - fixture.overflow, em = parseFloat(getComputedStyle(root).fontSize);
  host.style.width = target + "px";
  const plan = solveEditorialLayout(fixture.text, ir, root, target, fixture.halt !== false);
  rememberEditorialCanonicalChildren(root);
  if (plan) applyEditorialPlan(root, fixture.text, ir, plan);
  const inspect = () => {
    const glyphs = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let base = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (const part of new Intl.Segmenter("zh-HK", { granularity: "grapheme" }).segment(node.data)) {
        const range = document.createRange();
        range.setStart(node, part.index);
        range.setEnd(node, part.index + part.segment.length);
        const box = range.getBoundingClientRect();
        glyphs.push({ offset: base + part.index, text: part.segment, left: box.left, right: box.right, top: box.top, height: box.height });
      }
      base += node.length;
    }
    const quotes = glyphs.filter(g => g.text === '"').map(g => {
      const index = glyphs.indexOf(g), before = glyphs[index - 1], after = glyphs[index + 1];
      const sameLine = other => other && Math.abs(other.top + other.height / 2 - g.top - g.height / 2) < Math.min(other.height, g.height) / 2;
      return { ...g, bothNeighborsOverlap: !!sameLine(before) && !!sameLine(after) && before.right - g.left > 0.5 && g.right - after.left > 0.5 };
    });
    const margins = [...root.querySelectorAll("[style]")].filter(e => parseFloat(e.style.marginInlineEnd) < 0).map(e => {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.setEndAfter(e);
      return { offset: range.toString().length, deltaPx: parseFloat(e.style.marginInlineEnd) };
    });
    return { glyphs, quotes, margins, canonical: root.textContent };
  };
  const result = { plan, natural, target, em, ...inspect() };
  if (fixture.name.startsWith("original")) {
    const line = (start, end, final) => ({ start, end, final, hyphen: false, punctuationHalts: [], haltCompressionPx: 0, postHaltAdvancePx: measureEditorialInline(root, fixture.text, ir, start, end), finalAdvancePx: 0, hangingStartPx: 0, hangingEndPx: 0, adjustments: [] });
    const first = line(0, 5, false), last = line(5, fixture.text.length, true);
    first.finalAdvancePx = natural - 24;
    first.adjustments = [{ kind: "punctuation", deltaPx: -24, count: 2, glyphs: [
      { glyphStart: 1, glyphEnd: 2, offset: 1, direction: "closing", deltaPx: -12 },
      { glyphStart: 1, glyphEnd: 2, offset: 2, direction: "opening", deltaPx: -12 }
    ] }];
    last.finalAdvancePx = last.postHaltAdvancePx;
    const legacyPlan = { canonicalLength: fixture.text.length, targetWidthPx: target, lines: [first, last] };
    applyEditorialPlan(root, fixture.text, ir, legacyPlan);
    const legacyGeometry = inspect();
    result.legacy = { plan: legacyPlan, margins: legacyGeometry.margins, quote: legacyGeometry.quotes[0] };
  }
  host.remove();
  return result;
}
