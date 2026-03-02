/**
 * session-client.js -- HTTP client to talk to the daemon.
 *
 * sendCommand()  — POST a command to the running daemon
 * readSession()  — read session.json from output dir
 * isAlive()      — check if daemon is still responding
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SESSION_FILE = 'session.json';

/**
 * Read session.json from the output directory.
 * @returns {{ port: number, pid: number, startedAt: string } | null}
 */
export function readSession(outputDir) {
  const sessionPath = join(resolve(outputDir), SESSION_FILE);
  if (!existsSync(sessionPath)) return null;
  try {
    const data = JSON.parse(readFileSync(sessionPath, 'utf8'));
    // Validate session fields to reject partial writes or tampered files
    if (
      typeof data.port !== 'number' ||
      data.port < 1 || data.port > 65535 ||
      !Number.isInteger(data.port) ||
      typeof data.pid !== 'number'
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Check if the daemon is alive by hitting GET /status.
 */
export async function isAlive(outputDir) {
  const session = readSession(outputDir);
  if (!session) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${session.port}/status`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Send a command to the running daemon.
 * @param {string} command - Command name
 * @param {object} args - Command arguments
 * @param {string} outputDir - Session directory
 * @param {object} [opts]
 * @param {number} [opts.timeout=60000] - Request timeout in ms
 * @param {number} [opts.retries=1] - Retry count on transient 5xx errors
 * @returns {Promise<object>} The daemon's response
 */
export async function sendCommand(command, args, outputDir, opts = {}) {
  const session = readSession(outputDir);
  if (!session) throw new Error('No active session. Run `swiftbrowse open` first.');

  const timeout = opts.timeout ?? 60000;
  const maxAttempts = 1 + (opts.retries ?? 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${session.port}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, args }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      // ECONNREFUSED / ECONNRESET — daemon died or close command exited it
      if (command === 'close') return { ok: true };
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
        continue;
      }
      throw new Error(`Daemon not responding (pid ${session.pid}). Session may be stale.`);
    }

    // Retry on transient server errors (502, 503, 504)
    if (res.status >= 500 && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 250 * attempt));
      continue;
    }

    return res.json();
  }
}
