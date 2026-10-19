// SPDX-License-Identifier: Apache-2.0
// Modified for SwiftBrowse; includes BareBrowse code. Attribution and changes: NOTICE.
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
 * @returns {{ port: number, pid: number, token?: string, startedAt: string } | null}
 */
export function readSession(outputDir) {
  const sessionPath = join(resolve(outputDir), SESSION_FILE);
  if (!existsSync(sessionPath)) return null;
  try {
    const data = JSON.parse(readFileSync(sessionPath, 'utf8'));
    if (!data || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535 ||
        !Number.isInteger(data.pid) || data.pid < 1 ||
        (data.token !== undefined && !/^[a-f0-9]{64}$/.test(data.token))) return null;
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
 * @returns {Promise<object>} The daemon's response
 */
export async function sendCommand(command, args, outputDir) {
  const session = readSession(outputDir);
  if (!session) throw new Error('No active session. Run `swiftbrowse open` first.');

  let res;
  try {
    res = await fetch(`http://127.0.0.1:${session.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Authenticate to the daemon with the per-session token from session.json.
        ...(session.token ? { 'x-swiftbrowse-token': session.token } : {}),
      },
      body: JSON.stringify({ command, args }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    // ECONNREFUSED / ECONNRESET — daemon died
    if (command === 'close') {
      // Expected: daemon exited before response
      return { ok: true };
    }
    throw new Error(`Daemon not responding (pid ${session.pid}). Session may be stale.`);
  }

  return res.json();
}
