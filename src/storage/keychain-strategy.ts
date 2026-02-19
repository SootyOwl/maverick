import { Entry } from "@napi-rs/keyring";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// KeychainStrategy — unified keyring-with-file-fallback logic
// ---------------------------------------------------------------------------
//
// Both session.ts and keys.ts need the same pattern:
//   1. Probe OS keychain once (with optional on-disk cache)
//   2. Save to keyring when available, file otherwise (0600)
//   3. Load from keyring first, then file, optionally populating keyring
//   4. Warn once when falling back to file
//
// This class encapsulates that logic, parameterised by service name, path
// resolver, and options.
// ---------------------------------------------------------------------------

export interface KeychainStrategyOptions {
  /** Keyring service name (e.g. "maverick"). */
  service: string;

  /**
   * Resolve a logical account name to its file-fallback path.
   * Called every time a file operation is needed so env var overrides are
   * respected at call time.
   */
  filePath: (account: string) => string;

  /**
   * Map a logical account name to the keyring Entry account name.
   * Defaults to identity (account name used as-is).
   * Useful when the keyring account needs a prefix, e.g. "xmtp-key-<handle>".
   */
  keyringAccount?: (account: string) => string;

  /**
   * Directory for the `.keyring_ok` on-disk probe cache.
   * If omitted, no on-disk cache is written (in-memory only).
   * The function form allows env-var overrides to be respected at call time.
   */
  cacheDir?: (() => string) | string;

  /** Label used in the fallback warning message (e.g. "XMTP keys", "credentials"). */
  fallbackLabel?: string;

  /**
   * Env var name that, when set to "1", forces file-only mode (no keyring).
   * Defaults to "__MAVERICK_KEYRING_DISABLE".
   */
  disableEnvVar?: string;

  /**
   * Optional validator applied when loading a value from the file backend.
   * Return the value to accept it, or null to reject (treat as missing).
   * Useful for keys.ts which must reject legacy encrypted JSON.
   */
  fileValidator?: (raw: string) => string | null;
}

export class KeychainStrategy {
  private readonly service: string;
  private readonly filePathFn: (account: string) => string;
  private readonly keyringAccountFn: (account: string) => string;
  private readonly cacheDirFn: (() => string) | null;
  private readonly fallbackLabel: string;
  private readonly disableEnvVar: string;
  private readonly fileValidator: ((raw: string) => string | null) | null;

  // In-memory caches — one per strategy instance
  private _keyringOk: boolean | undefined;
  private _warnedFallback = false;

  constructor(opts: KeychainStrategyOptions) {
    this.service = opts.service;
    this.filePathFn = opts.filePath;
    this.keyringAccountFn = opts.keyringAccount ?? ((a) => a);
    this.cacheDirFn =
      opts.cacheDir === undefined
        ? null
        : typeof opts.cacheDir === "string"
          ? () => opts.cacheDir as string
          : opts.cacheDir;
    this.fallbackLabel = opts.fallbackLabel ?? "data";
    this.disableEnvVar = opts.disableEnvVar ?? "__MAVERICK_KEYRING_DISABLE";
    this.fileValidator = opts.fileValidator ?? null;
  }

  // ── Keyring probe ───────────────────────────────────────────────────────

  /** Returns true if the OS keychain is usable. Result is cached in-memory
   *  and optionally on disk. */
  useKeyring(): boolean {
    if (this._keyringOk !== undefined) {
      return this._keyringOk;
    }
    this._keyringOk = this._probeKeyring();
    return this._keyringOk;
  }

  private _probeKeyring(): boolean {
    // Env-var kill switch
    if (process.env[this.disableEnvVar] === "1") {
      return false;
    }

    // Check on-disk cache before touching the OS keychain
    const diskCached = this._readDiskCache();
    if (diskCached !== null) {
      return diskCached;
    }

    // First run: probe once, persist result
    try {
      const probe = new Entry(this.service, "__probe__");
      probe.setPassword("ok");
      probe.deletePassword();
      this._writeDiskCache(true);
      return true;
    } catch {
      this._writeDiskCache(false);
      return false;
    }
  }

  // ── Disk cache for keyring probe ────────────────────────────────────────

  private _diskCachePath(): string | null {
    if (!this.cacheDirFn) return null;
    const dir = this.cacheDirFn();
    return `${dir}/.keyring_ok`;
  }

  private _readDiskCache(): boolean | null {
    const path = this._diskCachePath();
    if (!path) return null;
    try {
      const raw = readFileSync(path, "utf-8").trim();
      if (raw === "1") return true;
      if (raw === "0") return false;
      return null;
    } catch {
      return null;
    }
  }

  private _writeDiskCache(available: boolean): void {
    const path = this._diskCachePath();
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, available ? "1" : "0", { mode: 0o600 });
    } catch {
      /* best effort */
    }
  }

  // ── Warn-once ───────────────────────────────────────────────────────────

  private _warnOnce(): void {
    if (this._warnedFallback) return;
    this._warnedFallback = true;
    console.warn(
      `[maverick] OS keychain unavailable \u2014 ${this.fallbackLabel} saved to file (mode 0600)`,
    );
  }

  // ── Keyring entry helper ─────────────────────────────────────────────────

  /** Create a keyring Entry, applying the keyringAccount mapper. */
  private _entry(account: string): Entry {
    return new Entry(this.service, this.keyringAccountFn(account));
  }

  // ── Keyring-only operations ──────────────────────────────────────────────
  // These allow callers (like session.ts) that manage their own composite
  // file fallback to still share the probe/cache/warn logic.

  /** Save a value to the keyring only (no file write). */
  saveToKeyring(account: string, value: string): void {
    this._entry(account).setPassword(value);
  }

  /** Load a value from the keyring only (no file fallback). */
  loadFromKeyring(account: string): string | null {
    try {
      const val = this._entry(account).getPassword();
      return val || null;
    } catch {
      return null;
    }
  }

  /** Delete a value from the keyring only. */
  deleteFromKeyring(account: string): void {
    try {
      this._entry(account).deletePassword();
    } catch {
      /* may not exist */
    }
  }

  /** Emit the fallback warning (once per strategy instance). */
  warnFallback(): void {
    this._warnOnce();
  }

  // ── Full operations (keyring + file) ───────────────────────────────────

  /** Save a value under `account`. Writes to keyring when available,
   *  always writes the file fallback. */
  save(account: string, value: string): void {
    if (this.useKeyring()) {
      try {
        this._entry(account).setPassword(value);
      } catch {
        /* fall through to file */
      }
    } else {
      this._warnOnce();
    }
    this._writeFile(account, value);
  }

  /** Load a value for `account`. Tries keyring first, then file.
   *  When file succeeds and keyring is available, opportunistically
   *  populates the keyring. */
  load(account: string): string | null {
    if (this.useKeyring()) {
      try {
        const val = this._entry(account).getPassword();
        if (val) return val;
      } catch {
        /* fall through to file */
      }
    }

    const fromFile = this._readFile(account);
    if (fromFile !== null) {
      // Opportunistically populate keyring
      if (this.useKeyring()) {
        try {
          this._entry(account).setPassword(fromFile);
        } catch {
          /* best effort */
        }
      }
      return fromFile;
    }

    return null;
  }

  /** Delete a value from both keyring and file. */
  delete(account: string): void {
    if (this.useKeyring()) {
      try {
        this._entry(account).deletePassword();
      } catch {
        /* may not exist */
      }
    }
    const fp = this.filePathFn(account);
    if (existsSync(fp)) {
      unlinkSync(fp);
    }
  }

  /** Reset in-memory and on-disk caches. For testing only. */
  _reset(): void {
    this._keyringOk = undefined;
    this._warnedFallback = false;
    const diskPath = this._diskCachePath();
    if (diskPath) {
      try {
        unlinkSync(diskPath);
      } catch {
        /* may not exist */
      }
    }
  }

  // ── File helpers ────────────────────────────────────────────────────────

  private _writeFile(account: string, value: string): void {
    const fp = this.filePathFn(account);
    mkdirSync(dirname(fp), { recursive: true });
    writeFileSync(fp, value, { mode: 0o600 });
  }

  private _readFile(account: string): string | null {
    const fp = this.filePathFn(account);
    try {
      const raw = readFileSync(fp, "utf-8").trim();
      if (this.fileValidator) {
        return this.fileValidator(raw);
      }
      return raw || null;
    } catch {
      return null;
    }
  }
}
