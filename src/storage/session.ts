import { Entry } from "@napi-rs/keyring";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SERVICE = "maverick";

// File-based fallback when OS keychain is unavailable.
// Stored at ~/.maverick/session.json with 0600 permissions (owner-only),
// same pattern as Git credential store and SSH keys.
function sessionFilePath(): string {
  return join(
    process.env.MAVERICK_DATA_DIR ?? join(homedir(), ".maverick"),
    "session.json",
  );
}

function keyringAvailable(): boolean {
  try {
    const probe = new Entry(SERVICE, "__probe__");
    probe.setPassword("ok");
    probe.deletePassword();
    return true;
  } catch {
    return false;
  }
}

// Cache the probe result for the lifetime of the process
let _keyringOk: boolean | undefined;
let _warnedFallback = false;
function useKeyring(): boolean {
  if (_keyringOk === undefined) {
    _keyringOk = keyringAvailable();
  }
  return _keyringOk;
}

function warnFallback(): void {
  if (_warnedFallback) return;
  _warnedFallback = true;
  const path = sessionFilePath();
  console.warn(
    `[maverick] OS keychain unavailable — credentials saved to ${path} (mode 0600)`,
  );
}

// ── Keyring backend ──────────────────────────────────────────────────────

function saveToKeyring(handle: string, password: string): void {
  new Entry(SERVICE, "handle").setPassword(handle);
  new Entry(SERVICE, "password").setPassword(password);
}

function loadFromKeyring(): { handle: string; password: string } | null {
  const handle = new Entry(SERVICE, "handle").getPassword();
  const password = new Entry(SERVICE, "password").getPassword();
  if (handle && password) {
    return { handle, password };
  }
  return null;
}

function clearKeyring(): void {
  try { new Entry(SERVICE, "handle").deletePassword(); } catch { /* may not exist */ }
  try { new Entry(SERVICE, "password").deletePassword(); } catch { /* may not exist */ }
}

// ── File backend ─────────────────────────────────────────────────────────

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
  if (useKeyring()) {
    saveToKeyring(handle, password);
  } else {
    warnFallback();
    saveToFile(handle, password);
  }
}

export function loadSession(): { handle: string; password: string } | null {
  if (useKeyring()) {
    return loadFromKeyring();
  }
  return loadFromFile();
}

export function clearSession(): void {
  if (useKeyring()) {
    clearKeyring();
  }
  clearFile(); // always clean up file too, in case backend switched
}
