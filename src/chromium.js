// SPDX-License-Identifier: Apache-2.0
// Modified for SwiftBrowse; includes BareBrowse code. Attribution and changes: NOTICE.
import { killTreeSync } from './process-tree.js';
/**
 * chromium.js — Find, launch, and connect to Chromium-based browsers.
 *
 * Supports: Chrome, Chromium, Brave, Edge, Vivaldi, Arc, Opera.
 * Modes: headless (launch new, no UI), headed (launch new, visible window).
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Block the current thread for `ms` without spawning a process. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Track launched browsers so we can clean them up if the parent crashes.
// Registered exit handlers (one-time) iterate this set on shutdown.
const activeBrowsers = new Set();
let exitHandlersRegistered = false;

function reapAllSync() {
  const toReap = [...activeBrowsers];
  activeBrowsers.clear();
  // Send SIGKILL to the parent AND the whole process group (detached:true
  // gives each Chromium its own pgid, so -pid targets every renderer/GPU/
  // network child without touching Node or its other children).
  for (const b of toReap) {
    killTreeSync(b.process);
  }
  // Then poll each for actual death before removing its profile dir —
  // Chromium can hold file handles briefly even after SIGKILL, which would
  // race rmSync. Cap the wait so a stuck process can't hang shutdown.
  for (const b of toReap) {
    for (let i = 0; i < 20; i++) {
      try { process.kill(b.process.pid, 0); } catch { break; }
      sleepSync(50);
    }
    if (b.ownedProfileDir) {
      try { rmSync(b.ownedProfileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
    }
  }
}

function registerExitHandlers() {
  if (exitHandlersRegistered) return;
  exitHandlersRegistered = true;
  // 'exit' is sync-only — must use synchronous APIs (SIGKILL, rmSync)
  process.once('exit', reapAllSync);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(sig, () => {
      reapAllSync();
      // Re-raise default behavior so the parent's exit code matches the signal
      process.kill(process.pid, sig);
    });
  }
}

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// Resolve Windows env vars once at startup (empty string fallback keeps paths safe)
const LOCALAPPDATA   = process.env.LOCALAPPDATA   || '';
const PROGRAMFILES   = process.env.PROGRAMFILES   || 'C:\\Program Files';
const PROGRAMFILES86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

/**
 * Ordered list of Chromium browser binary locations, platform-specific.
 * Absolute paths are checked with existsSync; bare names are looked up via PATH.
 */
const CANDIDATES = IS_WIN ? [
  // Windows — most common installs (absolute paths, checked with existsSync)
  join(LOCALAPPDATA,   'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(PROGRAMFILES,   'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(PROGRAMFILES86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(LOCALAPPDATA,   'Chromium', 'Application', 'chrome.exe'),
  join(PROGRAMFILES,   'Chromium', 'Application', 'chrome.exe'),
  join(LOCALAPPDATA,   'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  join(PROGRAMFILES,   'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  join(LOCALAPPDATA,   'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(PROGRAMFILES,   'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(PROGRAMFILES86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
] : IS_MAC ? [
  // macOS — standard /Applications installs
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
  '/Applications/Opera.app/Contents/MacOS/Opera',
  '/Applications/Arc.app/Contents/MacOS/Arc',
  // Homebrew installs
  '/usr/local/bin/chromium',
  '/opt/homebrew/bin/chromium',
] : [
  // Linux — command names resolved via `which`
  'chromium-browser',
  'chromium',
  'google-chrome-stable',
  'google-chrome',
  'brave-browser-stable',
  'brave-browser',
  'microsoft-edge-stable',
  'microsoft-edge',
  'vivaldi-stable',
  'vivaldi',
];

/**
 * Find the first available Chromium binary on the system.
 * @returns {string} Absolute path to the binary
 * @throws {Error} If no Chromium browser is found
 */
export function findBrowser() {
  for (const candidate of CANDIDATES) {
    try {
      // Absolute path (contains slash or backslash) — check with existsSync
      if (candidate.includes('/') || candidate.includes('\\')) {
        if (existsSync(candidate)) return candidate;
        continue;
      }
      // Command name — look up in PATH
      // `where` on Windows returns one path per line; `which` on Unix prints a single line.
      const out = execFileSync(IS_WIN ? 'where.exe' : 'which', [candidate], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
      const first = out.split('\n')[0].trim();
      if (first && existsSync(first)) return first;
    } catch {
      // Not found, try next
    }
  }

  const hint = IS_WIN
    ? 'Install Chrome from https://google.com/chrome'
    : IS_MAC
      ? 'Install Chrome from https://google.com/chrome or run: brew install --cask chromium'
      : 'sudo dnf install chromium  OR  sudo apt install chromium-browser';

  throw new Error(`No Chromium-based browser found. ${hint}`);
}

/**
 * Launch a Chromium instance with CDP enabled.
 * @param {object} [opts]
 * @param {string} [opts.binary] - Path to browser binary (auto-detected if omitted)
 * @param {number} [opts.port=0] - CDP port (0 = random available port)
 * @param {string} [opts.userDataDir] - Browser profile directory
 * @param {boolean} [opts.headed=false] - Launch in headed mode (with visible window)
 * @param {string} [opts.proxy] - Proxy server (e.g. 'http://host:port')
 * @returns {Promise<{wsUrl: string, process: import('node:child_process').ChildProcess, port: number}>}
 */
export async function launch(opts = {}) {
  const binary = opts.binary || findBrowser();
  const port = opts.port || 0;

  const args = [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--mute-audio',
    // Force every iframe (same-origin included) into its own renderer so it
    // gets a dedicated CDP session via Target.setAutoAttach. Without this,
    // same-origin iframes stay in the parent process — getFullAXTree still
    // works via frameId, but Input.dispatchMouseEvent on the parent session
    // uses parent-viewport coords while DOM.getBoxModel for iframe-internal
    // nodes returns frame-local coords, so clicks land off-target. The OOPIF
    // path side-steps that: each frame has its own Input domain.
    '--site-per-process',
    // Headless-only flags
    ...(!opts.headed ? ['--headless=new', '--hide-scrollbars'] : []),
    // Suppress permission prompts (location, notifications, camera, mic, etc.)
    '--disable-notifications',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--disable-features=MediaRouter',
    '--disable-dev-shm-usage',
  ];

  if (opts.proxy) {
    args.push(`--proxy-server=${opts.proxy}`);
  }

  // Track the temp profile dir only when we create one — caller-supplied dirs
  // are the caller's to manage. ownedProfileDir gets rm'd in cleanupBrowser.
  let ownedProfileDir = null;
  if (opts.userDataDir) {
    args.push(`--user-data-dir=${opts.userDataDir}`);
  } else {
    ownedProfileDir = mkdtempSync(join(tmpdir(), `swiftbrowse-${process.pid}-`));
    args.push(`--user-data-dir=${ownedProfileDir}`);
  }

  // about:blank as initial page
  args.push('about:blank');

  // detached:true makes Node call setsid() so Chromium becomes its own
  // process-group leader. Without this, the renderer/GPU/network children
  // it forks share the Node parent's process group — SIGTERM on the
  // Chromium PID only signals Chromium itself and the children linger,
  // holding profile-dir files for seconds after the parent exits. Under
  // parallel test load that races our rmSync cleanup. With a separate
  // pgid, cleanupBrowser can signal the whole group with process.kill(-pid).
  //
  // Trade-off: a terminal SIGINT (Ctrl-C) is delivered to the foreground
  // process group, which is now Node's — Chromium will NOT receive it
  // directly. The SIGINT handler in registerExitHandlers() that calls
  // reapAllSync() is what actually kills Chromium under Ctrl-C now. Do not
  // remove that handler without restoring some other path to reap children.
  const child = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: !opts.headed,
  });

  child.stdout.resume();

  // Parse the WebSocket URL from stderr
  // Chrome prints: "DevTools listening on ws://127.0.0.1:PORT/devtools/browser/UUID"
  let wsUrl;
  try {
  wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Browser failed to start within 10s. stderr: ${stderr}`));
    }, 10000);

    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-65536);
      const match = stderr.match(/ws:\/\/[^\s]+/);
      if (match) {
        clearTimeout(timeout);
        const endpoint = new URL(match[0]);
        if (endpoint.protocol !== 'ws:' || !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)) {
          reject(new Error('Browser reported a non-loopback debugging endpoint'));
          return;
        }
        resolve(match[0]);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to launch browser: ${err.message}`));
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (!stderr.includes('ws://')) {
        reject(new Error(`Browser exited with code ${code}. stderr: ${stderr}`));
      }
    });
  });

  } catch (err) {
    await cleanupBrowser({ process: child, ownedProfileDir });
    throw err;
  }

  // Extract port from wsUrl
  const actualPort = parseInt(new URL(wsUrl).port, 10);

  const browser = { wsUrl, process: child, port: actualPort, ownedProfileDir };

  // Register for parent-crash reaping. Auto-untrack on natural exit so
  // a normally-exited browser doesn't leave a stale entry around.
  registerExitHandlers();
  activeBrowsers.add(browser);
  child.once('exit', () => activeBrowsers.delete(browser));

  return browser;
}

/**
 * Kill a launched browser and remove its temp profile dir (if we created one).
 * Waits up to 2s for the process to actually exit before unlinking the dir —
 * Chromium can still hold files briefly after SIGTERM, which races rmSync.
 * Safe to call on partially-failed launches or already-dead processes.
 * @returns {Promise<void>}
 */
export async function cleanupBrowser(browser) {
  if (!browser) return;
  activeBrowsers.delete(browser);
  if (browser.process && !browser.process.killed && browser.process.exitCode === null) {
    /** @type {Promise<void>} */
    const exited = new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      browser.process.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    if (process.platform === 'win32') killTreeSync(browser.process);
    else try { browser.process.kill(); } catch {}
    await exited;
    // SIGKILL the whole Chromium process group. The parent may have exited
    // already (above) but renderer/GPU/network children — separate processes
    // under --site-per-process — can outlive it by seconds, and they hold
    // profile-dir file handles. Because launch() spawned with detached:true,
    // the children share Chromium's pgid (not Node's), so process.kill on a
    // negative PID reaps the whole group without touching anything else.
    try { process.kill(-browser.process.pid, 'SIGKILL'); } catch {
      // ESRCH = group already gone; anything else is best-effort here.
    }
  }
  if (browser.ownedProfileDir) {
    // Chromium spawns renderer + GPU + network + utility subprocesses (one
    // per site under --site-per-process from H2), and SIGTERM on the parent
    // doesn't guarantee the children have closed their profile-file handles
    // by the time the parent's exit event fires. Under parallel test load
    // we've seen handle-release take >2.5s. Retry budget here is 60×100ms
    // jittered (~6s+ worst case). Retry on ANY error short of ENOENT —
    // earlier code only retried ENOTEMPTY/EBUSY but Linux also reports
    // EPERM/EACCES transiently when an open-deleted file is still being
    // written to. force:true already swallows ENOENT, so the catch only
    // sees real failures.
    for (let i = 0; i < 60; i++) {
      try {
        rmSync(browser.ownedProfileDir, { recursive: true, force: true });
        break;
      } catch (err) {
        if (err.code === 'ENOENT') break; // already gone
        await new Promise((r) => setTimeout(r, 100 + Math.floor(Math.random() * 50)));
      }
    }
  }
}

/**
 * Get the CDP WebSocket URL for a browser already running with --remote-debugging-port.
 * @param {number} port - The debug port
 * @returns {Promise<string>} WebSocket URL
 */
export async function getDebugUrl(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!res.ok) throw new Error(`Cannot reach browser debug port at ${port}: ${res.status}`);
  const data = /** @type {{ webSocketDebuggerUrl?: string }} */ (await res.json());
  if (!data.webSocketDebuggerUrl) {
    throw new Error(`Browser debug port at ${port} returned no webSocketDebuggerUrl`);
  }
  return data.webSocketDebuggerUrl;
}

/**
 * Attach to a Chromium already running with --remote-debugging-port=<port>.
 * Returns the same shape as launch() but with process: null and
 * ownedProfileDir: null — cleanupBrowser() becomes a no-op so we never
 * kill a browser we did not start or remove a profile we do not own.
 * @param {object} opts
 * @param {number} opts.port - The debug port the running browser is listening on
 * @returns {Promise<{wsUrl: string, process: null, port: number, ownedProfileDir: null}>}
 */
export async function attach({ port }) {
  if (!port) throw new Error('attach({ port }) requires a port number');
  const wsUrl = await getDebugUrl(port);
  return { wsUrl, process: null, port, ownedProfileDir: null };
}
