/**
 * Integration tests for scraping features: text, extract, links, table,
 * screenshot({ selector }), and browse-batch CLI.
 *
 * Run: node --test test/integration/scraping.test.js
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../../src/index.js';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = resolve(import.meta.dirname, '..', '..', 'cli.js');
const NODE = process.execPath;

function cli(args, opts = {}) {
  return execFileSync(NODE, [CLI, ...args], {
    timeout: 90000,
    encoding: 'utf8',
    cwd: opts.cwd,
    ...opts,
  }).trim();
}

// ── HTML fixture loaded via data: URL ────────────────────────────────────────
// Contains: heading, paragraph, 2 links, 1 table with thead/tbody
const FIXTURE = `data:text/html,${encodeURIComponent(`<!DOCTYPE html>
<html><body>
  <h1 id="title">Scraping Test</h1>
  <p class="desc">Hello World paragraph</p>
  <a href="https://example.com" id="link1">Example</a>
  <a href="https://github.com" id="link2">GitHub</a>
  <table id="scores">
    <thead><tr><th>Name</th><th>Score</th></tr></thead>
    <tbody>
      <tr><td>Alice</td><td>95</td></tr>
      <tr><td>Bob</td><td>87</td></tr>
      <tr><td>Carol</td><td>92</td></tr>
    </tbody>
  </table>
</body></html>`)}`;

// ── text() ───────────────────────────────────────────────────────────────────

describe('page.text()', () => {
  it('extracts readable text from example.com', async () => {
    const page = await connect();
    try {
      await page.goto('https://example.com');
      const text = await page.text();
      assert.ok(typeof text === 'string', 'text should be a string');
      assert.ok(text.length > 0, 'text should not be empty');
      assert.ok(text.includes('Example Domain'), 'should include the page heading');
    } finally {
      await page.close();
    }
  });

  it('respects maxChars and appends truncation notice', async () => {
    const page = await connect();
    try {
      await page.goto('https://example.com');
      const text = await page.text({ maxChars: 10 });
      assert.ok(text.includes('[...'), 'should append a truncation notice');
    } finally {
      await page.close();
    }
  });

  it('returns string from fixture (no main element → fallback path)', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      const text = await page.text();
      assert.ok(typeof text === 'string');
      assert.ok(text.includes('Scraping Test'), 'should include h1 text');
      assert.ok(text.includes('Hello World'), 'should include paragraph text');
    } finally {
      await page.close();
    }
  });
});

// ── extract() ────────────────────────────────────────────────────────────────

describe('page.extract()', () => {
  it('extracts first matching element text', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      const title = await page.extract('h1');
      assert.equal(title, 'Scraping Test');
    } finally {
      await page.close();
    }
  });

  it('returns null for a non-existent selector', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      const result = await page.extract('.does-not-exist');
      assert.equal(result, null);
    } finally {
      await page.close();
    }
  });

  it('reads an element attribute with { attr }', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      const href = await page.extract('#link1', { attr: 'href' });
      // Browser normalises href → absolute URL; check domain only
      assert.ok(href.includes('example.com'), `expected example.com in href, got ${href}`);
    } finally {
      await page.close();
    }
  });

  it('returns all matches as array with { all: true }', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      const texts = await page.extract('a', { all: true });
      assert.ok(Array.isArray(texts), 'should return an array');
      assert.equal(texts.length, 2, 'should find both anchor elements');
      assert.ok(texts.includes('Example'));
      assert.ok(texts.includes('GitHub'));
    } finally {
      await page.close();
    }
  });

  it('extracts all hrefs with { all: true, attr: "href" }', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      const hrefs = await page.extract('a', { all: true, attr: 'href' });
      assert.ok(Array.isArray(hrefs));
      assert.ok(hrefs.some((h) => h.includes('example.com')));
      assert.ok(hrefs.some((h) => h.includes('github.com')));
    } finally {
      await page.close();
    }
  });
});

// ── links() ──────────────────────────────────────────────────────────────────

describe('page.links()', () => {
  it('returns array of { href, text } objects', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      const links = await page.links();
      assert.ok(Array.isArray(links));
      assert.ok(links.length >= 2, 'should find at least 2 links');
      const ex = links.find((l) => l.href.includes('example.com'));
      assert.ok(ex, 'should include example.com link');
      assert.equal(ex.text, 'Example');
    } finally {
      await page.close();
    }
  });

  it('filters out javascript: links', async () => {
    const page = await connect();
    try {
      const fixture = `data:text/html,${encodeURIComponent(
        '<a href="javascript:void(0)">JS</a><a href="https://example.com">Real</a>',
      )}`;
      await page.goto(fixture);
      const links = await page.links();
      assert.ok(!links.some((l) => l.href.startsWith('javascript:')), 'should exclude javascript: links');
      assert.ok(links.some((l) => l.href.includes('example.com')), 'should keep real links');
    } finally {
      await page.close();
    }
  });

  it('returns empty array for a page with no links', async () => {
    const page = await connect();
    try {
      const fixture = `data:text/html,${encodeURIComponent('<p>No links here</p>')}`;
      await page.goto(fixture);
      const links = await page.links();
      assert.deepEqual(links, []);
    } finally {
      await page.close();
    }
  });
});

// ── table() ──────────────────────────────────────────────────────────────────

describe('page.table()', () => {
  it('extracts headers and rows from a <thead>/<tbody> table', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      const data = await page.table('#scores');
      assert.ok(data !== null, 'should find the table');
      assert.deepEqual(data.headers, ['Name', 'Score']);
      assert.equal(data.rows.length, 3);
      assert.deepEqual(data.rows[0], ['Alice', '95']);
      assert.deepEqual(data.rows[1], ['Bob', '87']);
      assert.deepEqual(data.rows[2], ['Carol', '92']);
    } finally {
      await page.close();
    }
  });

  it('defaults to the first table on the page', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      const data = await page.table();
      assert.ok(data !== null);
      assert.deepEqual(data.headers, ['Name', 'Score']);
    } finally {
      await page.close();
    }
  });

  it('returns null when no table is present', async () => {
    const page = await connect();
    try {
      await page.goto('https://example.com');
      const data = await page.table();
      assert.equal(data, null);
    } finally {
      await page.close();
    }
  });

  it('treats first row as headers for a headerless table', async () => {
    const page = await connect();
    try {
      const fixture = `data:text/html,${encodeURIComponent(
        '<table><tr><td>Col A</td><td>Col B</td></tr><tr><td>1</td><td>2</td></tr></table>',
      )}`;
      await page.goto(fixture);
      const data = await page.table();
      assert.ok(data !== null);
      assert.deepEqual(data.headers, ['Col A', 'Col B']);
      assert.equal(data.rows.length, 1);
      assert.deepEqual(data.rows[0], ['1', '2']);
    } finally {
      await page.close();
    }
  });
});

// ── screenshot({ selector }) ─────────────────────────────────────────────────

describe('page.screenshot({ selector })', () => {
  it('returns base64 PNG for full page', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      const data = await page.screenshot();
      assert.ok(typeof data === 'string');
      assert.ok(data.length > 0);
      assert.ok(data.startsWith('iVBOR'), 'should be base64-encoded PNG');
    } finally {
      await page.close();
    }
  });

  it('crops to element — cropped image is smaller than full page', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      const full = await page.screenshot();
      const cropped = await page.screenshot({ selector: '#scores' });
      assert.ok(typeof cropped === 'string');
      assert.ok(cropped.length > 0);
      assert.ok(cropped.startsWith('iVBOR'), 'cropped should be base64-encoded PNG');
      assert.ok(
        cropped.length < full.length,
        `cropped (${cropped.length}) should be smaller than full (${full.length})`,
      );
    } finally {
      await page.close();
    }
  });

  it('falls back to full page when selector does not match', async () => {
    const page = await connect();
    try {
      await page.goto(FIXTURE);
      // Non-matching selector — screenshot should still succeed (no clip applied)
      const data = await page.screenshot({ selector: '.does-not-exist' });
      assert.ok(typeof data === 'string');
      assert.ok(data.startsWith('iVBOR'));
    } finally {
      await page.close();
    }
  });
});

// ── browse-batch (CLI) ────────────────────────────────────────────────────────

describe('CLI browse-batch', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'swiftbrowse-batch-'));

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scrapes two URLs and creates batch-*.yml files', () => {
    const out = cli(
      ['browse-batch', 'https://example.com', 'https://example.org'],
      { cwd: tmpDir },
    );
    assert.ok(out.includes('2/2 succeeded'), `expected 2/2 succeeded, got: ${out}`);
    const dir = join(tmpDir, '.swiftbrowse');
    const files = readdirSync(dir).filter((f) => f.startsWith('batch-') && f.endsWith('.yml'));
    assert.ok(files.length >= 2, `expected >= 2 batch files, found: ${files.length}`);
    const content = readFileSync(join(dir, files[0]), 'utf8');
    assert.ok(content.length > 0, 'batch file should not be empty');
  });

  it('reads URLs from --file flag', () => {
    const urlFile = join(tmpDir, 'urls.txt');
    writeFileSync(urlFile, 'https://example.com\nhttps://example.org\n');
    const out = cli(['browse-batch', `--file=${urlFile}`], { cwd: tmpDir });
    assert.ok(out.includes('2/2 succeeded'), `expected 2/2 succeeded, got: ${out}`);
  });
});
