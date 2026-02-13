#!/usr/bin/env node

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.__MAVERICK_TSX) {
  await import("../src/index.ts");
} else {
  const require = createRequire(import.meta.url);
  const tsxPath = require.resolve("tsx");

  try {
    execFileSync(process.execPath, [
      "--import", tsxPath,
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ], {
      env: { ...process.env, __MAVERICK_TSX: "1" },
      stdio: "inherit",
    });
  } catch (e) {
    process.exit(e.status ?? 1);
  }
}
