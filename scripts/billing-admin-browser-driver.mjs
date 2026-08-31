import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function chromeExecutable() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const command of ["google-chrome", "chromium", "chromium-browser"]) {
    try { return execFileSync("which", [command], { encoding: "utf8" }).trim(); } catch {}
  }
  throw new Error("Chrome or Chromium was not found");
}

export async function openBrowserHarness() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "billing-admin-cdp-"));
  const child = spawn(chromeExecutable(), [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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
        if (message.method === "Runtime.exceptionThrown") runtimeEvents.push({ method: message.method, text: message.params?.exceptionDetails?.text ?? "runtime exception", description: message.params?.exceptionDetails?.exception?.description ?? null });
        if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params?.type)) runtimeEvents.push({ method: message.method, type: message.params?.type ?? null, args: (message.params?.args ?? []).map(arg => arg.value ?? arg.description ?? arg.type).slice(0, 6) });
        continue;
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result ?? {});
    }
  });
  responsePipe.on("error", error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); });
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
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.enable", {}, sessionId);
  await call("Runtime.enable", {}, sessionId);
  await call("Accessibility.enable", {}, sessionId);

  const evaluate = async expression => {
    const { result } = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    return result.value;
  };
  const pressKey = async (key, code = key) => {
    const virtual = { Enter: 13, " ": 32, Escape: 27, ArrowRight: 39, ArrowLeft: 37, Tab: 9 }[key] ?? 0;
    await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtual }, sessionId);
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtual }, sessionId);
    await delay(100);
  };
  const findControl = (text, action) => evaluate(`(() => { const target=Array.from(document.querySelectorAll('button,[role="tab"]')).find(el=>(el.textContent||'').trim()===${JSON.stringify(text)}); if(!target)return {ok:false}; target.${action}(); return {ok:true,role:target.getAttribute('role'),text:(target.textContent||'').trim()}; })()`);
  const click = async text => { const result = await findControl(text, "click"); if (!result?.ok) throw new Error(`control not found: ${text}`); await delay(100); return result; };
  const focus = async text => { const result = await findControl(text, "focus"); if (!result?.ok) throw new Error(`focusable control not found: ${text}`); return result; };
  const setValue = async (id, value) => {
    const result = await evaluate(`(() => { const el=document.getElementById(${JSON.stringify(id)}); if(!el)return {ok:false}; const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return {ok:true}; })()`);
    if (!result?.ok) throw new Error(`control not found: #${id}`);
    await delay(80);
  };
  const navigate = async (url, width, height) => {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 }, sessionId);
    const result = await call("Page.navigate", { url }, sessionId);
    if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`);
  };
  const close = async () => {
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, delay(1000)]);
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
  return { call, close, evaluate, pressKey, click, focus, setValue, navigate, runtimeEvents, sessionId };
}
