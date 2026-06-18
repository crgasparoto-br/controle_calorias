import { execFileSync } from "node:child_process";

const SHARP_VERSION = "0.33.5";

if (process.env.SKIP_SHARP_RUNTIME_INSTALL === "1") {
  process.exit(0);
}

try {
  await import("sharp");
  process.exit(0);
} catch {
  // Installed below without writing package-lock.json or package.json.
}

console.log(`[postinstall] Installing sharp@${SHARP_VERSION} for local image overlays...`);
execFileSync(
  "npm",
  ["install", "--no-save", "--package-lock=false", `sharp@${SHARP_VERSION}`],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      SKIP_SHARP_RUNTIME_INSTALL: "1",
    },
  },
);
