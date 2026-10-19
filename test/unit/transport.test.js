import { it } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { createCDP } from '../../src/cdp.js';
import { createBiDi } from '../../src/bidi.js';

async function fakeServer(onConnection) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  if (onConnection) server.on('connection', onConnection);
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

function acceptSession(socket) {
  socket.on('message', data => {
    const message = JSON.parse(data.toString());
    if (message.method === 'session.new') socket.send(JSON.stringify({
      type: 'success', id: message.id, result: { sessionId: 'fixture', capabilities: {} },
    }));
  });
}

it('BiDi session setup times out and releases an unresponsive socket', async () => {
  const server = await fakeServer();
  try {
    await assert.rejects(createBiDi(server.url, { commandTimeout: 25 }), /BiDi command timed out: session.new/);
  } finally { await server.close(); }
});

it('a silent BiDi endpoint cannot leave commands pending indefinitely', async () => {
  const server = await fakeServer(acceptSession);
  const bidi = await createBiDi(server.url, { commandTimeout: 25 });
  try {
    await assert.rejects(bidi.send('browsingContext.getTree'), /BiDi command timed out/);
  } finally { bidi.close(); await server.close(); }
});

it('closing BiDi cancels command and event waits and rejects new work', async () => {
  const server = await fakeServer(acceptSession);
  const bidi = await createBiDi(server.url);
  try {
    const command = assert.rejects(bidi.send('browsingContext.getTree'), /WebSocket closed/);
    const event = assert.rejects(bidi.once('browsingContext.load'), /WebSocket closed/);
    bidi.close();
    await Promise.all([command, event]);
    await assert.rejects(bidi.send('browsingContext.getTree'), /WebSocket closed/);
    await assert.rejects(bidi.once('browsingContext.load'), /WebSocket closed/);
  } finally { bidi.close(); await server.close(); }
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
