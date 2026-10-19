// SPDX-License-Identifier: Apache-2.0
// Modified for SwiftBrowse; includes BareBrowse code. Attribution and changes: NOTICE.
/** Terminate only the browser process tree owned by this session. */
import { execFileSync } from 'node:child_process';

/** @param {import('node:child_process').ChildProcess} child */
export function killTreeSync(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // Windows has no POSIX process groups. Kill descendants before their parent
    // disappears, otherwise renderer processes can keep the profile locked.
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore', windowsHide: true, timeout: 5000,
      });
    } catch { /* Already exited, or Windows is shutting down. */ }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
  try { if (!child.killed) child.kill('SIGKILL'); } catch {}
}
