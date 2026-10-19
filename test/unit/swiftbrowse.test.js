import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, assertNavigable } from '../../src/url-guard.js';
import { parseViewport } from '../../src/viewport.js';
import { createBrowseTools } from '../../src/swiftagent.js';
import { createBrowseTools as compatibleTools } from '../../src/bareagent.js';
import { TOOLS } from '../../mcp-server.js';

describe('SwiftBrowse integration contracts', () => {
  it('keeps both agent entry points compatible without duplicate tool names', async () => {
    assert.equal(createBrowseTools, compatibleTools);
    const { tools, close } = createBrowseTools();
    const names = tools.map(tool => tool.name);
    assert.equal(new Set(names).size, names.length);
    for (const name of ['readable', 'text', 'extract', 'table', 'links']) {
      assert.ok(names.includes(name), `agent tools must include ${name}`);
      assert.ok(TOOLS.some(tool => tool.name === name), `MCP must include ${name}`);
    }
    await close();
  });

  it('normalizes bare domains without bypassing the navigation guard', () => {
    assert.equal(normalizeUrl('  example.com/path  '), 'https://example.com/path');
    assert.equal(normalizeUrl('localhost:3000/path'), 'https://localhost:3000/path');
    assert.equal(normalizeUrl('//example.com'), 'https://example.com');
    assert.equal(normalizeUrl('http://localhost:3000'), 'http://localhost:3000');
    for (const value of ['', '   ', null, 123]) assert.throws(() => normalizeUrl(value), /non-empty string/);
    for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings']) {
      assert.throws(() => assertNavigable(normalizeUrl(value)), /Refusing/);
    }
  });

  it('blocks canonicalized IPv4-mapped IPv6 and the entire link-local range', () => {
    for (const host of ['[::ffff:127.0.0.1]', '[::ffff:10.0.0.1]', '[::ffff:192.168.0.1]', '[febf::1]', 'localhost.']) {
      assert.throws(() => assertNavigable(`http://${host}/`, { blockPrivateNetwork: true }), /private/);
    }
    assert.doesNotThrow(() => assertNavigable('http://[::ffff:8.8.8.8]/', { blockPrivateNetwork: true }));
  });

  it('accepts both viewport forms and rejects malformed dimensions before launching', () => {
    assert.deepEqual(parseViewport('800x600'), { width: 800, height: 600 });
    assert.deepEqual(parseViewport({ width: 800, height: 600 }), { width: 800, height: 600 });
    assert.equal(parseViewport(undefined), undefined);
    for (const value of ['800', '0x600', '800x-1', '999999x600', { width: 1.5, height: 600 }, null]) {
      assert.throws(() => parseViewport(value), /viewport/);
    }
  });
});
