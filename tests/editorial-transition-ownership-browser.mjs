import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const [debugPort = "9231", sitePort = "4329"] = process.argv.slice(2);
const output = path.resolve(".editorial-review/transition-ownership");
fs.mkdirSync(output, { recursive: true });

const pages = await fetch("http://127.0.0.1:" + debugPort + "/json").then((response) => response.json());
const page = pages.find((entry) => entry.type === "page");
assert.ok(page?.webSocketDebuggerUrl, "Thorium CDP page is required");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let serial = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call("Page.navigate", { url: "http://127.0.0.1:" + sitePort + "/zh/" });
  for (let i = 0; i < 200; i++) {
    await sleep(50);
    if (await evaluate('document.readyState === "complete"')) break;
  }
  await evaluate("(async()=>{await document.fonts.ready;return true})()");
const clicked = await evaluate(`(() => { const link = document.querySelector('a[href="/zh/writing/typography-fixture/"]'); if (!(link instanceof HTMLElement)) return false; link.click(); return true; })()`);
  assert.equal(clicked, true, "fixture navigation link must exist");
  for (let i = 0; i < 200; i++) {
    await sleep(100);
    const settled = await evaluate('location.pathname === "/zh/writing/typography-fixture/" && document.querySelectorAll(".title-line-fragment").length === 0');
    if (settled) break;
  }
  await sleep(250);
  const result = await evaluate('(async () => { const { restoreEditorialPresentation } = await import("/src/scripts/editorial-composer-renderer.ts"); const { bindEditorialComposer } = await import("/src/scripts/editorial-composer.ts"); const root = document.querySelector(".article-head__title [data-editorial-root]"); if (!(root instanceof HTMLElement)) throw new Error("editorial title root missing"); const canonical = root.textContent; const inspect = () => ({ composed: root.dataset.editorialComposed ?? null, lines: root.querySelectorAll(".editorial-composed-line").length, textStable: root.textContent === canonical }); const before = inspect(); restoreEditorialPresentation(root); const restored = inspect(); bindEditorialComposer(document.querySelector("main")); const rebound = inspect(); restoreEditorialPresentation(root); return { before, restored, rebound, restoredAgain: inspect() }; })()');
  assert.equal(result.before.composed, "true");
  assert.ok(result.before.lines > 0, "destination title should start composed");
  assert.deepEqual(result.restored, { composed: null, lines: 0, textStable: true });
  assert.equal(result.rebound.composed, "true");
  assert.ok(result.rebound.lines > 0, "rebind should compose the same retained root");
  assert.deepEqual(result.restoredAgain, { composed: null, lines: 0, textStable: true });
  fs.writeFileSync(path.join(output, "restore-regression.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, result }, null, 2));
} finally {
  socket.close();
}
