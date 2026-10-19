import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDaemon } from '../../src/daemon.js';
import { sendCommand } from '../../src/session-client.js';
import { connect } from '../../src/index.js';

const url = 'data:text/html,' + encodeURIComponent('<main><h1>SwiftBrowse</h1><p>Visible text</p><p hidden>Hidden text</p><a href="https://example.com">Example</a><table><tr><th>Name</th></tr><tr><td>Ada</td></tr></table></main>');

it('daemon extraction and authenticated input validation work together', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'swiftbrowse-contract-'));
  try {
    const session = await startDaemon({ incognito: true, consent: false }, dir, url);
    const text = await sendCommand('text', {}, dir);
    assert.ok(readFileSync(text.file, 'utf8').includes('SwiftBrowse'));
    const extracted = await sendCommand('extract', { selector: 'h1' }, dir);
    assert.equal(extracted.value, 'SwiftBrowse');
    const table = await sendCommand('table', {}, dir);
    assert.deepEqual(JSON.parse(readFileSync(table.file, 'utf8')), { headers: ['Name'], rows: [['Ada']] });
    const links = await sendCommand('links', {}, dir);
    assert.equal(JSON.parse(readFileSync(links.file, 'utf8'))[0].text, 'Example');
    for (const body of ['null', '[]', '{"command":"toString"}', '{"command":"__proto__"}', '{"command":"status","args":[]}']) {
      const response = await fetch(`http://127.0.0.1:${session.port}/command`, {
        method: 'POST', headers: { 'x-swiftbrowse-token': session.token }, body,
      });
      assert.equal(response.status, 400, body);
    }
    assert.equal((await sendCommand('status', {}, dir)).ok, true, 'invalid requests leave the daemon usable');
  } finally {
    try { await sendCommand('close', {}, dir); } catch {}
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it('object viewports and visible-text extraction work in an actual browser', async () => {
  const page = await connect({ incognito: true, viewport: { width: 800, height: 600 } });
  try {
    await page.goto(url);
    const { result } = await page.cdp.send('Runtime.evaluate', { expression: '[innerWidth, innerHeight]', returnByValue: true });
    assert.deepEqual(result.value, [800, 600]);
    assert.ok(!(await page.text()).includes('Hidden text'));
    await assert.rejects(page.text({ maxChars: -1 }), /non-negative integer/);
  } finally { await page.close(); }
});
