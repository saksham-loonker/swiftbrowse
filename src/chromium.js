/**
 * chromium.js — Find, launch, and connect to Chromium-based browsers.
 *
 * Supports: Chrome, Chromium, Brave, Edge, Vivaldi, Arc, Opera.
 * Platforms: Windows, macOS, Linux.
 * Modes: headless (launch new), headed (connect to running).
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
      const cmd = IS_WIN ? `where "${candidate}"` : `which ${candidate} 2>/dev/null`;
      const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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
 * Launch a headless Chromium instance with CDP enabled.
 * @param {object} [opts]
 * @param {string} [opts.binary] - Path to browser binary (auto-detected if omitted)
 * @param {number} [opts.port=0] - CDP port (0 = random available port)
 * @param {string} [opts.userDataDir] - Browser profile directory
 * @param {string} [opts.proxy] - Proxy server URL
 * @param {string} [opts.viewport] - Viewport size (e.g. "1280x720")
 * @returns {Promise<{wsUrl: string, process: ChildProcess, port: number}>}
 */
export async function launch(opts = {}) {
  const binary = opts.binary || findBrowser();
  const port = opts.port || 0;

  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--mute-audio',
    '--hide-scrollbars',
    // Suppress permission prompts (location, notifications, camera, mic, etc.)
    '--disable-notifications',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--disable-features=MediaRouter',
  ];

  if (opts.proxy) {
    args.push(`--proxy-server=${opts.proxy}`);
  }

  if (opts.userDataDir) {
    args.push(`--user-data-dir=${opts.userDataDir}`);
  } else {
    // Unique temp profile per process — avoids locking user's real profile and
    // allows parallel instances. Use os.tmpdir() so this works on all platforms.
    const profileDir = join(tmpdir(), `swiftbrowse-${process.pid}-${Date.now()}`);
    args.push(`--user-data-dir=${profileDir}`);
  }

  // about:blank as initial page
  args.push('about:blank');

  const child = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Parse the WebSocket URL from stderr
  // Chrome prints: "DevTools listening on ws://127.0.0.1:PORT/devtools/browser/UUID"
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill(); // don't leave orphan browser process
      reject(new Error(`Browser failed to start within 10s. stderr: ${stderr}`));
    }, 10000);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/ws:\/\/[^\s]+/);
      if (match) {
        // Only accept localhost WebSocket URLs — reject remote debug endpoints
        const wsUrl = match[0];
        if (!wsUrl.startsWith('ws://127.0.0.1:') && !wsUrl.startsWith('ws://[::1]:')) {
          clearTimeout(timeout);
          child.kill();
          reject(new Error(`Browser reported non-localhost debug URL: ${wsUrl}`));
          return;
        }
        clearTimeout(timeout);
        resolve(wsUrl);
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

  // Extract port from wsUrl
  const actualPort = parseInt(new URL(wsUrl).port, 10);

  return { wsUrl, process: child, port: actualPort };
}

/**
 * Get the CDP WebSocket URL for a browser already running with --remote-debugging-port.
 * @param {number} port - The debug port
 * @returns {Promise<string>} WebSocket URL
 */
export async function getDebugUrl(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!res.ok) throw new Error(`Cannot reach browser debug port at ${port}: ${res.status}`);
  const data = await res.json();
  if (!data.webSocketDebuggerUrl) {
    throw new Error(`Browser at port ${port} did not return a WebSocket URL (missing webSocketDebuggerUrl)`);
  }
  return data.webSocketDebuggerUrl;
}
