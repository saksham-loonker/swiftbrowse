/** Process inspection for lifecycle tests on Windows and POSIX. */
import { execFileSync } from 'node:child_process';

export function processList() {
  if (process.platform === 'win32') {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(raw).map(row => ({
      pid: row.ProcessId, ppid: row.ParentProcessId,
      args: (row.CommandLine || '').replace(/\\/g, '/'),
    }));
  }
  return execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n').flatMap(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return m ? [{ pid: +m[1], ppid: +m[2], args: m[3] }] : [];
  });
}
