/**
 * auth.js — Cookie extraction from browser profiles + CDP injection.
 *
 * Extracts cookies from Chromium/Firefox SQLite databases,
 * decrypts Chromium cookies via OS keyring or DPAPI,
 * and injects them into a CDP session via Network.setCookie.
 *
 * Platforms: Windows (DPAPI), macOS (Keychain), Linux (KWallet/libsecret).
 * Requires Node >= 22 (node:sqlite built-in).
 */

import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, createDecipheriv, createDecipheriv as _gcm } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// --- Resolve platform-specific base paths ---

const HOME         = homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local');
const APPDATA      = process.env.APPDATA      || join(HOME, 'AppData', 'Roaming');

// --- Browser cookie database paths ---

/**
 * Platform-aware Chromium cookie paths.
 * Key: browser name, Value: path to Cookies SQLite file.
 */
const CHROMIUM_PATHS = IS_WIN ? {
  chrome:   join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Cookies'),
  // Newer Chrome (>= 96) moves cookies to Network\Cookies; fall back to Default\Cookies above
  chromeNet: join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies'),
  chromium: join(LOCALAPPDATA, 'Chromium', 'User Data', 'Default', 'Cookies'),
  brave:    join(LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Cookies'),
  edge:     join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cookies'),
  vivaldi:  join(LOCALAPPDATA, 'Vivaldi', 'User Data', 'Default', 'Cookies'),
} : IS_MAC ? {
  chrome:   join(HOME, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies'),
  chromium: join(HOME, 'Library', 'Application Support', 'Chromium', 'Default', 'Cookies'),
  brave:    join(HOME, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'Default', 'Cookies'),
  edge:     join(HOME, 'Library', 'Application Support', 'Microsoft Edge', 'Default', 'Cookies'),
  vivaldi:  join(HOME, 'Library', 'Application Support', 'Vivaldi', 'Default', 'Cookies'),
} : {
  // Linux
  chromium: join(HOME, '.config', 'chromium', 'Default', 'Cookies'),
  chrome:   join(HOME, '.config', 'google-chrome', 'Default', 'Cookies'),
  brave:    join(HOME, '.config', 'BraveSoftware', 'Brave-Browser', 'Default', 'Cookies'),
  edge:     join(HOME, '.config', 'microsoft-edge', 'Default', 'Cookies'),
  vivaldi:  join(HOME, '.config', 'vivaldi', 'Default', 'Cookies'),
};

/**
 * Find first available Chromium cookie database.
 * On Windows, prefers Network\Cookies (newer Chrome) over Default\Cookies.
 * @returns {{ path: string, browser: string } | null}
 */
function findChromiumCookieDb() {
  // Windows: check Network\Cookies first for Chrome (>= v96)
  if (IS_WIN && existsSync(CHROMIUM_PATHS.chromeNet)) {
    return { path: CHROMIUM_PATHS.chromeNet, browser: 'chrome' };
  }
  for (const [browser, path] of Object.entries(CHROMIUM_PATHS)) {
    if (browser === 'chromeNet') continue; // already checked
    if (existsSync(path)) return { path, browser };
  }
  return null;
}

/**
 * Find Firefox default profile cookies.
 * @returns {string | null} Path to cookies.sqlite
 */
function findFirefoxCookieDb() {
  const bases = IS_WIN
    ? [join(APPDATA, 'Mozilla', 'Firefox', 'Profiles')]
    : IS_MAC
      ? [join(HOME, 'Library', 'Application Support', 'Firefox', 'Profiles')]
      : [join(HOME, '.mozilla', 'firefox')];

  for (const base of bases) {
    try {
      for (const entry of readdirSync(base)) {
        if (entry.endsWith('.default-release') || entry.endsWith('.default')) {
          const p = join(base, entry, 'cookies.sqlite');
          if (existsSync(p)) return p;
        }
      }
    } catch { /* not installed */ }
  }
  return null;
}

// --- Chromium cookie decryption ---

// ============================================================
// Windows — DPAPI-wrapped AES-256-GCM key stored in Local State
// ============================================================

/**
 * Read the encrypted AES key from Chrome's Local State file on Windows,
 * then decrypt it with DPAPI via PowerShell.
 * Returns a 32-byte Buffer (AES-256 key).
 * @param {string} browser - 'chrome' | 'chromium' | 'brave' | 'edge' | 'vivaldi'
 * @returns {Buffer}
 */
function getWindowsChromeKey(browser) {
  const stateFiles = {
    chrome:   join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Local State'),
    chromeNet: join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Local State'),
    chromium: join(LOCALAPPDATA, 'Chromium', 'User Data', 'Local State'),
    brave:    join(LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Local State'),
    edge:     join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Local State'),
    vivaldi:  join(LOCALAPPDATA, 'Vivaldi', 'User Data', 'Local State'),
  };

  const stateFile = stateFiles[browser];
  if (!stateFile || !existsSync(stateFile)) {
    throw new Error(`Local State not found for browser "${browser}"`);
  }

  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const encryptedKeyB64 = state?.os_crypt?.encrypted_key;
  if (!encryptedKeyB64) throw new Error('No os_crypt.encrypted_key in Local State');

  // Strip DPAPI prefix (first 5 bytes: "DPAPI")
  const encryptedKey = Buffer.from(encryptedKeyB64, 'base64').subarray(5);

  // Use PowerShell to invoke DPAPI (CryptUnprotectData) — no native Node binding needed
  const b64 = encryptedKey.toString('base64');
  const script = `[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${b64}'), $null, 'CurrentUser'))`;
  const result = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

  return Buffer.from(result, 'base64');
}

/**
 * Decrypt a Windows Chrome v10/v20 AES-256-GCM cookie.
 * Format: v10 + 12-byte nonce + ciphertext + 16-byte auth tag.
 * @param {Uint8Array} encrypted
 * @param {Buffer} aesKey - 32-byte key from DPAPI
 * @returns {string}
 */
function decryptWindowsCookie(encrypted, aesKey) {
  const buf = Buffer.from(encrypted);
  if (buf.length === 0) return '';

  const prefix = buf.subarray(0, 3).toString('ascii');
  if (prefix !== 'v10' && prefix !== 'v20') {
    // Not AES-GCM — may be DPAPI-encrypted directly (older Chrome)
    // Fall back to returning as UTF-8; caller catches errors
    return buf.toString('utf8');
  }

  const nonce = buf.subarray(3, 15);           // 12 bytes
  const ciphertext = buf.subarray(15, buf.length - 16);
  const authTag = buf.subarray(buf.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', aesKey, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ============================================================
// macOS — Keychain + AES-128-CBC (1003 PBKDF2 iterations)
// ============================================================

/**
 * Get Chromium encryption password from macOS Keychain.
 * @param {string} browser
 * @returns {string}
 */
function getMacChromePassword(browser) {
  const serviceNames = {
    chrome:   'Chrome Safe Storage',
    chromium: 'Chromium Safe Storage',
    brave:    'Brave Safe Storage',
    edge:     'Microsoft Edge Safe Storage',
    vivaldi:  'Vivaldi Safe Storage',
  };
  const service = serviceNames[browser] || 'Chrome Safe Storage';
  try {
    return execSync(`security find-generic-password -w -s "${service}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'peanuts'; // fallback when keychain entry absent
  }
}

// ============================================================
// Linux — KWallet / libsecret + AES-128-CBC (1 PBKDF2 iteration)
// ============================================================

/**
 * Get Chromium encryption password from Linux OS keyring.
 */
function getLinuxChromePassword() {
  // KDE / KWallet
  try {
    const b64 = execSync(
      'kwallet-query -r "Chromium Safe Storage" -f "Chromium Keys" kdewallet',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (b64) return Buffer.from(b64, 'base64').toString('binary');
  } catch { /* not KDE */ }

  // GNOME keyring / libsecret
  try {
    const pw = execSync(
      'secret-tool lookup application chrome',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (pw) return pw;
  } catch { /* not GNOME */ }

  return 'peanuts';
}

/**
 * Derive AES-128 key from Chromium keyring password.
 * - Linux: 1 PBKDF2-SHA1 iteration
 * - macOS: 1003 PBKDF2-SHA1 iterations
 * @param {string} password
 * @returns {Buffer}
 */
function deriveKey(password) {
  const iterations = IS_MAC ? 1003 : 1;
  return pbkdf2Sync(password, 'saltysalt', iterations, 16, 'sha1');
}

/**
 * Decrypt a Chromium v10/v11 AES-128-CBC cookie value (Linux/macOS).
 * @param {Uint8Array} encrypted
 * @param {Buffer} aesKey - 16-byte key
 * @returns {string}
 */
function decryptCbcCookie(encrypted, aesKey) {
  const buf = Buffer.from(encrypted);
  if (buf.length === 0) return '';

  const prefix = buf.subarray(0, 3).toString('ascii');
  if (prefix !== 'v10' && prefix !== 'v11') {
    return buf.toString('utf8'); // not encrypted
  }

  const iv = Buffer.alloc(16, ' ');
  const decipher = createDecipheriv('aes-128-cbc', aesKey, iv);
  const payload = buf.subarray(3);
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
}

// --- Extractors ---

/**
 * Extract cookies from a Chromium-based browser.
 * Dispatches to the correct decryption strategy for the current platform.
 * @param {string} dbPath - Path to Cookies SQLite database
 * @param {string} browser - Browser name (for key lookup)
 * @param {string} [domain] - Filter by domain
 * @returns {Array<object>} Cookies in CDP Network.setCookie format
 */
export function extractChromiumCookies(dbPath, browser, domain) {
  // Resolve decryption context once per call
  let aesKey = null;
  let winKey = null;

  if (IS_WIN) {
    try { winKey = getWindowsChromeKey(browser); } catch { /* no DPAPI key */ }
  } else {
    const password = IS_MAC ? getMacChromePassword(browser) : getLinuxChromePassword();
    aesKey = deriveKey(password);
  }

  // Copy to temp to avoid WAL lock issues with live browser databases.
  // node:sqlite does not support file:// URIs on Windows — plain paths only.
  const tmpPath = join(tmpdir(), `swiftbrowse-chrome-${basename(dbPath)}-${Date.now()}.tmp`);
  copyFileSync(dbPath, tmpPath);
  let rows;
  try {
    const db = new DatabaseSync(tmpPath, { readonly: true });
    let sql = `SELECT host_key, name, value, encrypted_value, path,
      CAST(expires_utc AS TEXT) AS expires_utc, is_secure, is_httponly, samesite
      FROM cookies`;
    const params = [];
    if (domain) {
      sql += ` WHERE host_key LIKE ?`;
      params.push(`%${domain}%`);
    }
    const stmt = db.prepare(sql);
    rows = params.length ? stmt.all(...params) : stmt.all();
    db.close();
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  const SAMESITE = { 0: 'None', 1: 'Lax', 2: 'Strict' };

  return rows.map((row) => {
    const enc = Buffer.from(row.encrypted_value);
    let value;
    try {
      if (enc.length > 0) {
        if (IS_WIN && winKey) {
          value = decryptWindowsCookie(enc, winKey);
        } else if (aesKey) {
          value = decryptCbcCookie(enc, aesKey);
        } else {
          value = row.value || '';
        }
      } else {
        value = row.value || '';
      }
    } catch {
      value = row.value || '';
    }

    // Chrome timestamp: microseconds since 1601-01-01
    const CHROME_EPOCH = 11644473600000000n;
    const MAX_EXPIRES  = 32503680000000000n; // ~year 3000 in Chrome microseconds
    let expires = -1;
    try {
      const expiresUtc = row.expires_utc ? BigInt(row.expires_utc) : 0n;
      if (expiresUtc > 0n && expiresUtc < MAX_EXPIRES) {
        expires = Number((expiresUtc - CHROME_EPOCH) / 1000000n);
      }
    } catch {
      // BigInt conversion failed — treat as session cookie
    }

    return {
      name: row.name,
      value,
      domain: row.host_key,
      path: row.path,
      expires,
      secure: row.is_secure === 1,
      httpOnly: row.is_httponly === 1,
      sameSite: SAMESITE[row.samesite] || 'Lax',
    };
  }).filter((c) => c.value); // drop empty cookies
}

/**
 * Extract cookies from Firefox (no encryption needed).
 * @param {string} dbPath - Path to cookies.sqlite
 * @param {string} [domain] - Filter by domain
 * @returns {Array<object>} Cookies in CDP Network.setCookie format
 */
export function extractFirefoxCookies(dbPath, domain) {
  // Copy to temp to avoid WAL lock issues with live browser databases.
  // node:sqlite does not support file:// URIs on Windows — plain paths only.
  const tmpPath = join(tmpdir(), `swiftbrowse-firefox-${basename(dbPath)}-${Date.now()}.tmp`);
  copyFileSync(dbPath, tmpPath);
  let rows;
  try {
    const db = new DatabaseSync(tmpPath, { readonly: true });
    let sql = `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite
      FROM moz_cookies`;
    const params = [];
    if (domain) {
      sql += ` WHERE host LIKE ?`;
      params.push(`%${domain}%`);
    }
    const stmt = db.prepare(sql);
    rows = params.length ? stmt.all(...params) : stmt.all();
    db.close();
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  const SAMESITE = { 0: 'None', 1: 'Lax', 2: 'Strict' };

  return rows.map((row) => ({
    name: row.name,
    value: row.value,
    domain: row.host,
    path: row.path,
    expires: row.expiry || -1,
    secure: row.isSecure === 1,
    httpOnly: row.isHttpOnly === 1,
    sameSite: SAMESITE[row.sameSite] || 'Lax',
  })).filter((c) => c.value);
}

// --- Public API ---

/**
 * Extract cookies from the user's browser, auto-detecting which browser to use.
 * @param {object} [opts]
 * @param {string} [opts.browser] - 'chromium', 'chrome', 'brave', 'edge', 'firefox', or 'auto'
 * @param {string} [opts.domain] - Filter by domain
 * @returns {Array<object>} Cookies in CDP-compatible format
 */
export function extractCookies(opts = {}) {
  const browser = opts.browser || 'auto';
  const domain = opts.domain;

  if (browser === 'firefox') {
    const db = findFirefoxCookieDb();
    if (!db) throw new Error('Firefox cookie database not found');
    return extractFirefoxCookies(db, domain);
  }

  if (browser !== 'auto') {
    // Resolve the right path key (Windows has chromeNet alias)
    const pathKey = IS_WIN && browser === 'chrome' && existsSync(CHROMIUM_PATHS.chromeNet)
      ? 'chromeNet'
      : browser;
    const path = CHROMIUM_PATHS[pathKey];
    if (!path) throw new Error(`Unknown browser: "${browser}"`);
    if (!existsSync(path)) throw new Error(`${browser} cookie database not found at ${path}`);
    return extractChromiumCookies(path, browser, domain);
  }

  // Auto: try all browsers, merge (last-write-wins by name+domain)
  const all = new Map();
  const chromium = findChromiumCookieDb();
  if (chromium) {
    for (const c of extractChromiumCookies(chromium.path, chromium.browser, domain))
      all.set(`${c.name}@${c.domain}`, c);
  }
  const firefox = findFirefoxCookieDb();
  if (firefox) {
    for (const c of extractFirefoxCookies(firefox, domain))
      all.set(`${c.name}@${c.domain}`, c);
  }
  if (all.size === 0) throw new Error('No browser cookie database found');
  return [...all.values()];
}

/**
 * Inject cookies into a CDP session via Network.setCookies (single batched call).
 * @param {object} session - CDP session handle (from cdp.session())
 * @param {Array<object>} cookies - Cookies from extractCookies()
 */
export async function injectCookies(session, cookies) {
  if (!cookies || cookies.length === 0) return;
  await session.send('Network.setCookies', {
    cookies: cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expires: cookie.expires > 0 ? cookie.expires : undefined,
    })),
  });
}

/**
 * Extract cookies for a URL and inject them into a CDP session.
 * Convenience function combining extractCookies + injectCookies.
 * @param {object} session - CDP session handle
 * @param {string} url - URL to extract cookies for
 * @param {object} [opts] - Options passed to extractCookies
 */
export async function authenticate(session, url, opts = {}) {
  // Strip to registrable domain so mail.google.com → google.com
  // This ensures parent-domain cookies (.google.com) are included
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  const parts = hostname.split('.');
  const domain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;
  const cookies = extractCookies({ ...opts, domain });
  if (cookies.length > 0) {
    await injectCookies(session, cookies);
  }
  return cookies.length;
}
