import { it } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { createCDP } from '../../src/cdp.js';

async function fakeServer() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    async close() {
      for (const client of server.clients) client.terminate();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

it('a silent CDP endpoint cannot leave commands pending indefinitely', async () => {
  const server = await fakeServer();
  const cdp = await createCDP(server.url, { commandTimeout: 25 });
  try {
    await assert.rejects(cdp.send('Browser.getVersion'), /CDP command timed out/);
  } finally { cdp.close(); await server.close(); }
});

it('closing CDP cancels pending commands and event waits immediately', async () => {
  const server = await fakeServer();
  const cdp = await createCDP(server.url);
  try {
    const command = assert.rejects(cdp.send('Page.navigate'), /WebSocket closed/);
    const event = assert.rejects(cdp.once('Page.loadEventFired'), /WebSocket closed/);
    cdp.close();
    await Promise.all([command, event]);
    await assert.rejects(cdp.send('Browser.getVersion'), /WebSocket closed/);
  } finally { cdp.close(); await server.close(); }
});
