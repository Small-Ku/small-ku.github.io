import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const [debugPort = "9231", sitePort = "4329"] = process.argv.slice(2);
const output = path.resolve(".editorial-review/title-line-transition");
fs.mkdirSync(output, { recursive: true });

const pages = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
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

try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url: `http://127.0.0.1:${sitePort}/` });
  for (let i = 0; i < 200; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (await evaluate('document.readyState === "complete"')) break;
  }

  const result = await evaluate(`(async () => {
    const { prepareTitleLineMorph, retargetTitleLineMorph, cleanupTitleLineMorph } = await import("/src/scripts/title-line-transition.ts");
    const text = "A project title with different source and destination line plans";
    const style = (width) => "display:block;width:" + width + "px;font:600 20px/1.1 Arial,sans-serif;letter-spacing:-.02em;margin:0;";
    const sourceRoot = document.createElement("a");
    sourceRoot.dataset.vtProjectOrigin = "";
    sourceRoot.dataset.workSlug = "generic-mn-fixture";
    sourceRoot.style.cssText = "position:fixed;left:0;top:0;width:110px;";
    const sourceSlot = document.createElement("div");
    sourceSlot.dataset.vtProjectTitle = "";
    const sourceTitle = document.createElement("h2");
    sourceTitle.style.cssText = style(110);
    sourceTitle.textContent = text;
    sourceSlot.append(sourceTitle);
    sourceRoot.append(sourceSlot);
    document.body.append(sourceRoot);

    const nextDocument = document.implementation.createHTMLDocument("incoming project");
    const main = nextDocument.createElement("main");
    const targetRoot = nextDocument.createElement("section");
    targetRoot.dataset.vtProjectDestination = "";
    targetRoot.dataset.workSlug = "generic-mn-fixture";
    const targetSlot = nextDocument.createElement("div");
    targetSlot.dataset.vtProjectTitle = "";
    const targetTitle = nextDocument.createElement("h1");
    targetTitle.style.cssText = style(245);
    targetTitle.textContent = text;
    targetSlot.append(targetTitle);
    targetRoot.append(targetSlot);
    main.append(targetRoot);
    nextDocument.body.append(main);

    const morph = prepareTitleLineMorph(sourceRoot, nextDocument, false, {
      sourceTitle: "[data-vt-project-title]",
      targetRoot: '[data-vt-project-destination][data-work-slug="generic-mn-fixture"]',
      targetTitle: "[data-vt-project-title]"
    });
    if (!morph) throw new Error("generic Project title morph did not prepare");
    const sourceLineCount = morph.sourceLines.length;
    const targetLineCount = morph.targetLines.length;
    if (sourceLineCount === targetLineCount) throw new Error("fixture must exercise different M:N line plans");
    const originalSourceChildren = morph.sourceChildren;
    const targetInDocument = document.createElement("section");
    targetInDocument.dataset.vtProjectDestination = "";
    targetInDocument.dataset.workSlug = "generic-mn-fixture";
    const actualSlot = document.createElement("div");
    actualSlot.dataset.vtProjectTitle = "";
    const actualTitle = document.createElement("h1");
    actualTitle.style.cssText = style(245);
    actualTitle.textContent = text;
    actualSlot.append(actualTitle);
    targetInDocument.append(actualSlot);
    document.body.append(targetInDocument);
    if (!retargetTitleLineMorph(morph, actualSlot)) throw new Error("generic Project M:N retarget failed");
    const sourceFragments = sourceTitle.querySelectorAll(".title-line-fragment").length;
    const targetFragments = actualTitle.querySelectorAll(".title-line-fragment").length;
    const transitionNames = Array.from(document.querySelectorAll(".title-line-fragment"), (node) => node.style.viewTransitionName);
    cleanupTitleLineMorph(morph);
    const cleanupRestoredSourceIdentity = sourceTitle.firstChild === originalSourceChildren[0];
    const cleanupRestoredTargetText = actualTitle.textContent === text && !actualTitle.querySelector(".title-line-fragment");
    sourceRoot.remove();
    targetInDocument.remove();
    return { sourceLineCount, targetLineCount, sourceFragments, targetFragments, transitionNames, cleanupRestoredSourceIdentity, cleanupRestoredTargetText };
  })()`);

  assert.notEqual(result.sourceLineCount, result.targetLineCount);
  assert.ok(result.sourceFragments > 0 && result.targetFragments > 0);
  assert.ok(result.transitionNames.every((name) => name.startsWith("title-line-")));
  assert.equal(result.cleanupRestoredSourceIdentity, true);
  assert.equal(result.cleanupRestoredTargetText, true);

  const evidence = { passed: true, genericFixture: result };
  fs.writeFileSync(path.join(output, "project-mn.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  socket.close();
}
