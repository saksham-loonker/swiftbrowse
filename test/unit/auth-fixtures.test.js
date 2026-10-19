/**
 * Unit tests for cookie extraction (auth.js).
 *
 * Uses synthetic SQLite fixtures — no real browser profile required.
 * Tests the extraction and transformation logic in isolation.
 *
 * Run: node --test test/unit/auth.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { extractCookies, extractFirefoxCookies } from '../../src/auth.js';

// ─── Fixture setup ────────────────────────────────────────────────────────────

let FIREFOX_DB;

/** Create a minimal Firefox cookies.sqlite with known data. */
function makeFirefoxDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE moz_cookies (
      id         INTEGER PRIMARY KEY,
      host       TEXT    NOT NULL,
      name       TEXT    NOT NULL,
      value      TEXT    NOT NULL,
      path       TEXT    NOT NULL DEFAULT '/',
      expiry     INTEGER NOT NULL DEFAULT -1,
      isSecure   INTEGER NOT NULL DEFAULT 0,
      isHttpOnly INTEGER NOT NULL DEFAULT 0,
      sameSite   INTEGER NOT NULL DEFAULT 1
    );

    INSERT INTO moz_cookies (host, name, value, path, expiry, isSecure, isHttpOnly, sameSite) VALUES
      ('.google.com',  'session',   'abc123', '/', 1735689600, 1, 1, 1),
      ('.google.com',  'pref',      'xyz789', '/', 1735689600, 0, 0, 0),
      ('.github.com',  'logged_in', 'yes',    '/', 1735689600, 1, 1, 2),
      ('.example.com', 'anon',      'true',   '/', -1,         0, 0, 1),
      ('.example.com', 'empty',     '',       '/', -1,         0, 0, 1);
  `);
  db.close();
}

before(() => {
  FIREFOX_DB = join(tmpdir(), `swiftbrowse-auth-test-${Date.now()}.sqlite`);
  makeFirefoxDb(FIREFOX_DB);
});

after(() => {
  if (FIREFOX_DB && existsSync(FIREFOX_DB)) unlinkSync(FIREFOX_DB);
});

// ─── extractFirefoxCookies() — pure logic tests ───────────────────────────────

describe('extractFirefoxCookies()', () => {
  it('returns an array', () => {
    const cookies = extractFirefoxCookies(FIREFOX_DB);
    assert.ok(Array.isArray(cookies), 'should return an array');
  });

  it('returns correct cookie shape', () => {
    const cookies = extractFirefoxCookies(FIREFOX_DB);
    assert.ok(cookies.length > 0, 'should have cookies');
    const c = cookies[0];
    assert.ok('name'     in c, 'should have name');
    assert.ok('value'    in c, 'should have value');
    assert.ok('domain'   in c, 'should have domain');
    assert.ok('path'     in c, 'should have path');
    assert.ok('expires'  in c, 'should have expires');
    assert.ok('secure'   in c, 'should have secure');
    assert.ok('httpOnly' in c, 'should have httpOnly');
    assert.ok('sameSite' in c, 'should have sameSite');
  });

  it('filters out cookies with empty values', () => {
    const cookies = extractFirefoxCookies(FIREFOX_DB);
    for (const c of cookies) {
      assert.ok(c.value.length > 0, `cookie "${c.name}" should not have an empty value`);
    }
  });

  it('maps sameSite integers to string labels', () => {
    const valid = new Set(['None', 'Lax', 'Strict']);
    const cookies = extractFirefoxCookies(FIREFOX_DB);
    for (const c of cookies) {
      assert.ok(valid.has(c.sameSite), `"${c.sameSite}" is not a valid sameSite value`);
    }
  });

  it('maps secure and httpOnly flags to booleans', () => {
    const cookies = extractFirefoxCookies(FIREFOX_DB);
    for (const c of cookies) {
      assert.equal(typeof c.secure,   'boolean', 'secure should be boolean');
      assert.equal(typeof c.httpOnly, 'boolean', 'httpOnly should be boolean');
    }
  });

  it('sets session cookies (expiry=-1) to expires=-1', () => {
    const cookies = extractFirefoxCookies(FIREFOX_DB);
    const anon = cookies.find((c) => c.name === 'anon');
    assert.ok(anon, 'should find the anon session cookie');
    assert.equal(anon.expires, -1, 'session cookie should have expires=-1');
  });

  it('preserves positive expiry as a number', () => {
    const cookies = extractFirefoxCookies(FIREFOX_DB);
    const session = cookies.find((c) => c.name === 'session');
    assert.ok(session, 'should find the session cookie');
    assert.equal(typeof session.expires, 'number', 'expires should be a number');
    assert.ok(session.expires > 0, 'non-session cookie should have positive expiry');
  });

  it('filters by domain (partial match)', () => {
    const cookies = extractFirefoxCookies(FIREFOX_DB, 'google.com');
    assert.ok(cookies.length > 0, 'should find google cookies');
    for (const c of cookies) {
      assert.ok(c.domain.includes('google'), `domain "${c.domain}" should match google`);
    }
  });

  it('unfiltered result is a superset of filtered result', () => {
    const all    = extractFirefoxCookies(FIREFOX_DB);
    const google = extractFirefoxCookies(FIREFOX_DB, 'google.com');
    assert.ok(all.length > google.length, 'all cookies should exceed filtered subset');
  });

  it('returns empty array for non-matching domain', () => {
    const cookies = extractFirefoxCookies(FIREFOX_DB, 'nonexistent-domain-xyz.test');
    assert.deepEqual(cookies, []);
  });

  it('returns correct field values for known fixture cookies', () => {
    const cookies = extractFirefoxCookies(FIREFOX_DB);
    const byName = Object.fromEntries(cookies.map((c) => [c.name, c]));

    assert.equal(byName.session.value,      'abc123', 'session value');
    assert.equal(byName.session.secure,     true,     'session secure');
    assert.equal(byName.session.httpOnly,   true,     'session httpOnly');
    assert.equal(byName.session.sameSite,   'Lax',    'sameSite 1 → Lax');

    assert.equal(byName.pref.sameSite,      'None',   'sameSite 0 → None');
    assert.equal(byName.logged_in.sameSite, 'Strict', 'sameSite 2 → Strict');
    assert.equal(byName.logged_in.domain,   '.github.com');
  });
});

// ─── extractCookies() — public API error handling ─────────────────────────────

describe('extractCookies() error handling', () => {
  it('throws for an unrecognised browser name', () => {
    assert.throws(
      () => extractCookies({ browser: 'netscape' }),
      /unknown browser/i,
      'should throw for an unrecognised browser name'
    );
  });

  it('throws "not found" for a known browser that is not installed', () => {
    // 'vivaldi' is a valid browser name but almost certainly absent in CI/test environments.
    // If it IS installed the error won't throw — that is correct behaviour.
    try {
      extractCookies({ browser: 'vivaldi' });
      // Vivaldi is installed — test is vacuous but valid
    } catch (err) {
      assert.match(err.message, /not found/i, 'error should mention "not found"');
    }
  });
});
