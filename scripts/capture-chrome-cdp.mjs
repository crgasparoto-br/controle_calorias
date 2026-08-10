#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) continue;
    values[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

function required(values, key) {
  const value = values[key];
  if (!value) throw new Error(`Missing required argument --${key}`);
  return value;
}

function chromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    "google-chrome",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    const paths = (process.env.PATH ?? "").split(path.delimiter);
    for (const directory of paths) {
      const resolved = path.join(directory, candidate);
      if (fs.existsSync(resolved)) return resolved;
    }
  }
  throw new Error("Chrome or Chromium was not found.");
}

async function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function fetchJson(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while requesting ${url}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const target = targets.find(item => item.type === "page");
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // Chrome can expose the port before the target list is ready.
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for a Chrome page target.");
}

function createCdpClient(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Could not connect to Chrome DevTools Protocol.")),
      { once: true }
    );
  });

  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) {
      request.reject(
        new Error(`${message.error.message ?? "CDP command failed"}`)
      );
    } else {
      request.resolve(message.result ?? {});
    }
  });

  return {
    async send(method, params = {}) {
      await opened;
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function waitForExpression(client, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastException = null;
  while (Date.now() < deadline) {
    const result = await client.send("Runtime.evaluate", {
      expression: `Boolean(${expression})`,
      returnByValue: true,
      awaitPromise: true,
    });
    lastException = result.exceptionDetails ?? null;
    if (!lastException && result.result?.value === true) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for browser readiness expression: ${expression}${
      lastException ? ` (${lastException.text ?? "runtime exception"})` : ""
    }`
  );
}

async function terminate(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    new Promise(resolve => setTimeout(() => resolve(false), 1_000)),
  ]);
  if (exited === false && child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise(resolve => child.once("exit", resolve)),
      new Promise(resolve => setTimeout(resolve, 1_000)),
    ]);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = required(args, "url");
  const output = required(args, "output");
  const mode = args.mode ?? "screenshot";
  if (!new Set(["screenshot", "dom"]).has(mode)) {
    throw new Error("--mode must be screenshot or dom");
  }
  const width = Number(args.width ?? 1440);
  const height = Number(args.height ?? 900);
  const timeoutMs = Number(args.timeout ?? 30_000);
  const readyExpression =
    args["wait-expression"] ??
    'document.readyState === "complete" && Boolean(document.body)';
  const settleMs = Number(args["settle-ms"] ?? 700);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "controle-calorias-cdp-"));
  const activePortFile = path.join(profile, "DevToolsActivePort");
  const logPath = `${output}.chrome.log`;
  const logFd = fs.openSync(logPath, "w");
  const child = spawn(
    chromeBinary(),
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-features=MediaRouter,OptimizationHints,Translate",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-first-run",
      "--no-proxy-server",
      "--proxy-bypass-list=*",
      "--safebrowsing-disable-auto-update",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", logFd, logFd] }
  );

  let client;
  try {
    await waitForFile(activePortFile, timeoutMs);
    const [portLine] = fs.readFileSync(activePortFile, "utf8").trim().split(/\r?\n/);
    const port = Number(portLine);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid DevTools port: ${portLine}`);
    }
    const target = await waitForTarget(port, timeoutMs);
    client = createCdpClient(target.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send("Page.navigate", { url });
    await waitForExpression(client, readyExpression, timeoutMs);
    await new Promise(resolve => setTimeout(resolve, settleMs));

    if (mode === "screenshot") {
      const result = await client.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      fs.writeFileSync(output, Buffer.from(result.data, "base64"));
    } else {
      const result = await client.send("Runtime.evaluate", {
        expression: "document.documentElement.outerHTML",
        returnByValue: true,
      });
      fs.writeFileSync(output, String(result.result?.value ?? ""), "utf8");
    }

    if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
      throw new Error(`Browser evidence output is empty: ${output}`);
    }
  } finally {
    client?.close();
    await terminate(child);
    fs.closeSync(logFd);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
