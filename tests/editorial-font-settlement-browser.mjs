import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const [debugPort = "9232", sitePort = "4329"] = process.argv.slice(2);
const output = path.resolve(".editorial-review/font-settlement");
fs.mkdirSync(output, { recursive: true });
const pages = await fetch("http://127.0.0.1:" + debugPort + "/json").then(r => r.json());
const page = pages.find(entry => entry.type === "page");
assert.ok(page?.webSocketDebuggerUrl, "fresh Thorium CDP page required");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
const listeners = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id) {
    const task = pending.get(msg.id);
    if (!task) return;
    pending.delete(msg.id);
    msg.error ? task.reject(new Error(msg.error.message)) : task.resolve(msg.result);
    return;
  }
  for (const fn of listeners.get(msg.method) || []) fn(msg.params);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  pending.set(requestId, { resolve, reject });
  ws.send(JSON.stringify({ id: requestId, method, params }));
});
const on = (method, fn) => { const list = listeners.get(method) || []; list.push(fn); listeners.set(method, list); };
const evaluate = async expression => {
  const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let pausedRequest = null;
let pausedResolve;
const paused = new Promise(resolve => { pausedResolve = resolve; });
on("Fetch.requestPaused", params => {
  if (!params.request.url.includes("/fonts/zhudou/")) { call("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {}); return; }
  if (!pausedRequest) { pausedRequest = params.requestId; pausedResolve(params); }
});
try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Network.enable");
  await call("Network.setCacheDisabled", { cacheDisabled: true });
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/fonts/zhudou/*", requestStage: "Response" }] });
  const source = String.raw`
    window.__fontProbe = { events: [], composedMutations: [] };
    const mark = kind => window.__fontProbe.events.push({ kind, at: performance.now() });
    document.fonts.addEventListener("loading", () => mark("loading"));
    document.fonts.addEventListener("loadingdone", () => mark("loadingdone"));
    document.fonts.addEventListener("loadingerror", () => mark("loadingerror"));
    addEventListener("DOMContentLoaded", () => {
      new MutationObserver(records => {
        for (const record of records) if (record.attributeName === "data-editorial-composed") {
          window.__fontProbe.composedMutations.push({ at: performance.now(), present: record.target.hasAttribute("data-editorial-composed") });
        }
      }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-editorial-composed"] });
    });
  `;
  const preload = await call("Page.addScriptToEvaluateOnNewDocument", { source });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.navigate", { url: "http://127.0.0.1:" + sitePort + "/zh/writing/typography-fixture/?font-settlement-probe=1" });
  for (let i = 0; i < 200; i++) { await sleep(25); if (await evaluate('document.readyState === "complete"')) break; }
  const pausedEvent = await Promise.race([paused, sleep(5000).then(() => null)]);
  assert.ok(pausedEvent, "Zhudou response must be intercepted in fresh profile");
  await sleep(150);
  const before = await evaluate(`(() => ({ status: document.fonts.status, loaded: document.fonts.check('16px "Zhudou Sans"'), events: __fontProbe.events.slice(), composed: document.querySelectorAll("[data-editorial-root][data-editorial-composed]").length, mutations: __fontProbe.composedMutations.slice() }))()`);
  await call("Fetch.continueRequest", { requestId: pausedRequest });
  await evaluate('(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()');
  await sleep(350);
  const after = await evaluate(`(() => ({ status: document.fonts.status, loaded: document.fonts.check('16px "Zhudou Sans"'), lang: document.documentElement.lang, events: __fontProbe.events.slice(), composed: document.querySelectorAll("[data-editorial-root][data-editorial-composed]").length, mutations: __fontProbe.composedMutations.slice(), roots: [...document.querySelectorAll("[data-editorial-root]")].map(r => ({ canonical: JSON.parse(r.dataset.editorialIr || "null")?.canonicalLength, lines: r.querySelectorAll(".editorial-composed-line").length })) }))()`);
  assert.equal(after.status, "loaded");
  assert.equal(after.loaded, true);
  assert.equal(after.lang, "zh-HK");
  const done = after.events.find(event => event.kind === "loadingdone");
  assert.ok(done, "real font completion must emit loadingdone");
  assert.ok(after.composed > 0, "editorial roots must remain composed after font settlement");
  assert.ok(after.mutations.some(m => m.at > done.at), "loadingdone must be followed by canonical restore/recomposition mutations");
  assert.ok(after.roots.some(root => root.lines > 0), "final font geometry must be materialized");
  const result = { passed: true, interceptedUrl: pausedEvent.request.url, before, after };
  fs.writeFileSync(path.join(output, "delayed-font.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, before: { status: before.status, loaded: before.loaded, events: before.events, composed: before.composed }, after: { status: after.status, loaded: after.loaded, events: after.events, composed: after.composed, postDoneMutations: after.mutations.filter(m => m.at > done.at).length } }, null, 2));
  await call("Page.removeScriptToEvaluateOnNewDocument", { identifier: preload.identifier });
} finally {
  if (pausedRequest) call("Fetch.continueRequest", { requestId: pausedRequest }).catch(() => {});
  await call("Fetch.disable").catch(() => {});
  await call("Network.setCacheDisabled", { cacheDisabled: false }).catch(() => {});
  ws.close();
}
