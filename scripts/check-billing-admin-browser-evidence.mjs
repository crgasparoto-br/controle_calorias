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
const port = 9337;
const child = spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  let version;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) { version = await response.json(); break; }
    } catch {}
    await delay(100);
  }
  if (!version?.webSocketDebuggerUrl) throw new Error("Chrome DevTools endpoint did not start");

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result ?? {});
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.enable", {}, sessionId);
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
    await call("Page.navigate", { url }, sessionId);
    await delay(900);
    const { result } = await call("Runtime.evaluate", {
      expression: `(() => ({title: document.body.innerText.includes('Billing, catálogo e governança'), campaigns: document.body.innerText.includes('Campanhas e entregas'), economics: document.body.innerText.includes('Economia por identidade comercial'), rollout: document.body.innerText.includes('Rollout comercial'), overflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth, focusable: document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])').length, tables: document.querySelectorAll('table').length}))()`,
      returnByValue: true,
    }, sessionId);
    const value = result.value;
    if (!value.title || !value.campaigns || !value.economics || !value.rollout) throw new Error(`${viewport.name}: required billing sections were not rendered`);
    if (value.overflow) throw new Error(`${viewport.name}: root horizontal overflow detected`);
    if (value.focusable < 10) throw new Error(`${viewport.name}: insufficient focusable controls rendered`);
    viewportEvidence.push({ ...viewport, ...value });
  }

  await call("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId);
  await call("Page.navigate", { url }, sessionId);
  await delay(900);
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
  ws.close();
} finally {
  child.kill("SIGTERM");
  await fs.rm(profile, { recursive: true, force: true });
}
