import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [url, outputPath] = process.argv.slice(2);
if (!url || !outputPath) throw new Error("usage: node check-billing-admin-browser-evidence.mjs <url> <output>");

async function executable() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const { execFileSync } = await import("node:child_process");
  for (const command of ["google-chrome", "chromium", "chromium-browser"]) {
    try { return execFileSync("which", [command], { encoding: "utf8" }).trim(); } catch {}
  }
  throw new Error("Chrome or Chromium was not found");
}

const chromeBin = await executable();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "billing-admin-cdp-"));
const child = spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  const requestPipe = child.stdio[3];
  const responsePipe = child.stdio[4];
  if (!requestPipe || !responsePipe) throw new Error("Chrome DevTools pipe did not start");

  let nextId = 1;
  let responseBuffer = Buffer.alloc(0);
  const pending = new Map();
  const runtimeEvents = [];
  responsePipe.on("data", chunk => {
    responseBuffer = Buffer.concat([responseBuffer, chunk]);
    let separatorIndex;
    while ((separatorIndex = responseBuffer.indexOf(0)) >= 0) {
      const frame = responseBuffer.subarray(0, separatorIndex).toString("utf8");
      responseBuffer = responseBuffer.subarray(separatorIndex + 1);
      if (!frame) continue;
      const message = JSON.parse(frame);
      if (!message.id) {
        if (message.method === "Runtime.exceptionThrown") {
          runtimeEvents.push({
            method: message.method,
            text: message.params?.exceptionDetails?.text ?? "runtime exception",
            description: message.params?.exceptionDetails?.exception?.description ?? null,
            url: message.params?.exceptionDetails?.url ?? null,
            lineNumber: message.params?.exceptionDetails?.lineNumber ?? null,
            columnNumber: message.params?.exceptionDetails?.columnNumber ?? null,
          });
        }
        if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params?.type)) {
          runtimeEvents.push({
            method: message.method,
            type: message.params?.type ?? null,
            args: (message.params?.args ?? []).map(arg => arg.value ?? arg.description ?? arg.type).slice(0, 6),
          });
        }
        continue;
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result ?? {});
    }
  });
  responsePipe.on("error", error => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  child.on("exit", code => {
    if (code === 0 || pending.size === 0) return;
    const error = new Error(`Chrome DevTools pipe exited with code ${code}`);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    requestPipe.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });

  const readBillingState = async sessionId => {
    const { result } = await call("Runtime.evaluate", {
      expression: `(() => { const text = document.body?.innerText ?? ''; const root = document.getElementById('root'); return {title: text.includes('Billing, catálogo e governança'), campaigns: text.includes('Campanhas e entregas'), economics: text.includes('Economia por identidade comercial'), rollout: text.includes('Rollout comercial'), overflow: document.documentElement.scrollWidth > innerWidth || (document.body?.scrollWidth ?? 0) > innerWidth, focusable: document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])').length, tables: document.querySelectorAll('table').length, readyState: document.readyState, href: location.href, rootChildCount: root?.childElementCount ?? 0, bodyText: text.trim().slice(0, 1200), rootHtml: (root?.innerHTML ?? '').slice(0, 1200)}; })()`,
      returnByValue: true,
    }, sessionId);
    return result.value;
  };
  const waitForBillingState = async sessionId => {
    let value;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      value = await readBillingState(sessionId);
      if (value.title && value.campaigns && value.economics && value.rollout) return value;
      await delay(100);
    }
    return value;
  };
  const assertBillingReady = (label, value) => {
    if (value.title && value.campaigns && value.economics && value.rollout) return;
    const diagnostics = {
      state: value,
      runtimeEvents: runtimeEvents.slice(-12),
    };
    throw new Error(`${label}: required billing sections were not rendered; diagnostics=${JSON.stringify(diagnostics)}`);
  };

  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.enable", {}, sessionId);
  await call("Runtime.enable", {}, sessionId);
  await call("Accessibility.enable", {}, sessionId);

  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const viewportEvidence = [];
  for (const viewport of viewports) {
    await call("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 600,
    }, sessionId);
    const navigation = await call("Page.navigate", { url }, sessionId);
    if (navigation.errorText) throw new Error(`${viewport.name}: navigation failed: ${navigation.errorText}`);
    const value = await waitForBillingState(sessionId);
    assertBillingReady(viewport.name, value);
    if (value.overflow) throw new Error(`${viewport.name}: root horizontal overflow detected`);
    if (value.focusable < 10) throw new Error(`${viewport.name}: insufficient focusable controls rendered`);
    viewportEvidence.push({ ...viewport, ...value, bodyText: undefined, rootHtml: undefined });
  }

  await call("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId);
  const keyboardNavigation = await call("Page.navigate", { url }, sessionId);
  if (keyboardNavigation.errorText) throw new Error(`keyboard: navigation failed: ${keyboardNavigation.errorText}`);
  const keyboardReady = await waitForBillingState(sessionId);
  assertBillingReady("keyboard", keyboardReady);
  await call("Runtime.evaluate", { expression: "document.body.tabIndex=-1; document.body.focus();" }, sessionId);
  const keyboardSequence = [];
  for (let index = 0; index < 10; index += 1) {
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }, sessionId);
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }, sessionId);
    const { result } = await call("Runtime.evaluate", {
      expression: `(() => { const e=document.activeElement; return {tag:e?.tagName ?? '', text:(e?.getAttribute('aria-label') || e?.textContent || e?.getAttribute('placeholder') || '').trim().slice(0,120)}; })()`,
      returnByValue: true,
    }, sessionId);
    keyboardSequence.push(result.value);
  }
  const uniqueFocus = new Set(keyboardSequence.map(item => `${item.tag}:${item.text}`).filter(value => !value.startsWith("BODY:") && !value.startsWith("HTML:")));
  if (uniqueFocus.size < 5) throw new Error(`keyboard navigation reached only ${uniqueFocus.size} unique controls`);

  const ax = await call("Accessibility.getFullAXTree", {}, sessionId);
  const roles = new Map();
  const names = [];
  for (const node of ax.nodes ?? []) {
    const role = node.role?.value;
    if (role) roles.set(role, (roles.get(role) ?? 0) + 1);
    const name = node.name?.value;
    if (name) names.push(name);
  }
  for (const requiredRole of ["heading", "button", "textbox", "table"]) {
    if (!roles.get(requiredRole)) throw new Error(`accessibility tree lacks role ${requiredRole}`);
  }
  if (!names.some(name => String(name).includes("Billing, catálogo e governança"))) throw new Error("accessibility tree lacks the page heading");

  await call("Runtime.evaluate", { expression: "document.body.style.zoom='200%'" }, sessionId);
  await delay(200);
  const zoomResult = await call("Runtime.evaluate", {
    expression: `(() => ({zoom: getComputedStyle(document.body).zoom || document.body.style.zoom, scrollWidth: document.documentElement.scrollWidth, innerWidth}))()`,
    returnByValue: true,
  }, sessionId);

  const evidence = {
    schemaVersion: 1,
    route: "/admin/billing",
    viewports: viewportEvidence,
    keyboard: { sequence: keyboardSequence, uniqueFocusCount: uniqueFocus.size },
    accessibility: { roleCounts: Object.fromEntries(roles), pageHeadingObserved: true },
    zoom200: zoomResult.result.value,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
} finally {
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(1000)]);
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
