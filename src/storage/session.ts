import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { KeychainStrategy } from "./keychain-strategy.js";

// Session storage: Bluesky handle + app password.
//
// Keyring backend: two separate entries ("bsky-handle", "bsky-password").
// File fallback: a single JSON file at ~/.maverick/session.json (0600).
//
// Uses KeychainStrategy for keyring probe/cache/warn logic, but manages
// the composite JSON file itself (strategy's per-account file ops don't
// apply here since both values share one file).

const HANDLE_ACCOUNT = "bsky-handle";
const PASSWORD_ACCOUNT = "bsky-password";

function sessionFilePath(): string {
  return join(
    process.env.MAVERICK_DATA_DIR ?? join(homedir(), ".maverick"),
    "session.json",
  );
}

// Strategy instance — used for keyring probe + keyring-only operations.
// filePath is unused (session manages its own composite file) but required
// by the interface, so we point it at the session.json path.
const strategy = new KeychainStrategy({
  service: "maverick",
  filePath: () => sessionFilePath(),
  fallbackLabel: "credentials",
});

// ── File backend (composite JSON) ─────────────────────────────────────

function saveToFile(handle: string, password: string): void {
  const filePath = sessionFilePath();
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ handle, password }), { mode: 0o600 });
}

function loadFromFile(): { handle: string; password: string } | null {
  const filePath = sessionFilePath();
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (typeof data.handle === "string" && typeof data.password === "string" &&
        data.handle && data.password) {
      return { handle: data.handle, password: data.password };
    }
    return null;
  } catch {
    return null;
  }
}

function clearFile(): void {
  const filePath = sessionFilePath();
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export function saveSession(handle: string, password: string): void {
  if (strategy.useKeyring()) {
    strategy.saveToKeyring(HANDLE_ACCOUNT, handle);
    strategy.saveToKeyring(PASSWORD_ACCOUNT, password);
  } else {
    strategy.warnFallback();
    saveToFile(handle, password);
  }
}

export function loadSession(): { handle: string; password: string } | null {
  if (strategy.useKeyring()) {
    const handle = strategy.loadFromKeyring(HANDLE_ACCOUNT);
    const password = strategy.loadFromKeyring(PASSWORD_ACCOUNT);
    if (handle && password) {
      return { handle, password };
    }
    return null;
  }
  return loadFromFile();
}

export function clearSession(): void {
  if (strategy.useKeyring()) {
    strategy.deleteFromKeyring(HANDLE_ACCOUNT);
    strategy.deleteFromKeyring(PASSWORD_ACCOUNT);
  }
  clearFile(); // always clean up file too, in case backend switched
}
