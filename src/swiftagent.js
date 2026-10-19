// SPDX-License-Identifier: Apache-2.0
// Modified for SwiftBrowse; includes BareBrowse code. Attribution and changes: NOTICE.
/**
 * bareagent.js — Tool adapter for bareagent's Loop.
 *
 * Usage:
 *   import { createBrowseTools } from 'swiftbrowse/src/bareagent.js';
 *   const { tools, close } = createBrowseTools();
 *   const result = await loop.run(messages, tools);
 *   await close();
 *
 * Action tools auto-return a fresh snapshot so the LLM always sees the result.
 * 300ms settle delay after actions for DOM updates.
 */

/// <reference path="./wearehere.d.ts" />

import { browse, connect } from './index.js';
import { formatReadable } from './readable.js';

// Optional: privacy assessment via wearehere
let assessFn = null;
try {
  ({ assess: assessFn } = await import('wearehere'));
} catch {}

const SETTLE_MS = 300;
const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

/**
 * @typedef {object} BrowseTool
 * @property {string} name
 * @property {string} description
 * @property {object} parameters - JSON-schema-shaped parameter spec
 * @property {(args?: any) => Promise<any>} execute
 */

/**
 * Create bareagent-compatible browse tools.
 * @param {import('./index.js').ConnectOptions} [opts] - Options passed to connect() for session tools
 * @returns {{ tools: BrowseTool[], close: () => Promise<void> }}
 */
export function createBrowseTools(opts = {}) {
  let _page = null;

  async function getPage() {
    if (!_page) _page = await connect(opts);
    return _page;
  }

  async function actionAndSnapshot(fn) {
    const page = await getPage();
    await fn(page);
    await settle();
    return await page.snapshot();
  }

  /** @type {BrowseTool[]} */
  const tools = [
    {
      name: 'browse',
      description: 'One-shot: navigate to a URL and return a pruned ARIA snapshot. Stateless.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to browse' },
          pruneMode: { type: 'string', enum: ['act', 'read'], description: '"act" (default) for interactive elements only; "read" for paragraphs and long text (articles/docs).' },
        },
        required: ['url'],
      },
      execute: async ({ url, pruneMode }) => await browse(url, pruneMode ? { ...opts, pruneMode } : opts),
    },
    {
      name: 'goto',
      description: 'Navigate to a URL and return the page snapshot.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['url'],
      },
      execute: async ({ url }) => actionAndSnapshot((page) => page.goto(url)),
    },
    {
      name: 'snapshot',
      description: 'Get the current ARIA snapshot. Returns a YAML-like tree with [ref=N] markers on interactive elements.',
      parameters: {
        type: 'object',
        properties: {
          pruneMode: { type: 'string', enum: ['act', 'read'], description: '"act" (default) for interactive elements only; "read" for paragraphs and long text (articles/docs).' },
        },
      },
      execute: async (/** @type {{ pruneMode?: string }} */ { pruneMode } = {}) => {
        const page = await getPage();
        return await page.snapshot(pruneMode ? { mode: pruneMode } : undefined);
      },
    },
    {
      name: 'readable',
      description: 'Extract the main article as clean reading text (title + body prose, chrome stripped — Firefox Reader View engine). Use ONLY to READ/SUMMARISE article-like pages (news, blogs, docs, wiki). For interacting, or for non-article pages, use snapshot. Returns a low-confidence hint to use snapshot when the page is not an article.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const page = await getPage();
        return formatReadable(await page.readable());
      },
    },
    {
      name: 'click',
      description: 'Click an element by its ref from the snapshot. Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from snapshot' },
        },
        required: ['ref'],
      },
      execute: async ({ ref }) => actionAndSnapshot((page) => page.click(ref)),
    },
    {
      name: 'type',
      description: 'Type text into an element by its ref. Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from snapshot' },
          text: { type: 'string', description: 'Text to type' },
          clear: { type: 'boolean', description: 'Clear existing content first' },
        },
        required: ['ref', 'text'],
      },
      execute: async ({ ref, text, clear }) => actionAndSnapshot((page) => page.type(ref, text, { clear })),
    },
    {
      name: 'press',
      description: 'Press a special key (Enter, Tab, Escape, etc.). Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key name (Enter, Tab, Escape, Backspace, Delete, arrows, Home, End, PageUp, PageDown, Space)' },
        },
        required: ['key'],
      },
      execute: async ({ key }) => actionAndSnapshot((page) => page.press(key)),
    },
    {
      name: 'scroll',
      description: 'Scroll the page up or down. Pass direction ("up"/"down") or a numeric deltaY. Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction — "up" or "down" (scrolls ~3 screen-heights)' },
          deltaY: { type: 'number', description: 'Pixels to scroll (positive=down, negative=up). Overrides direction if both given.' },
        },
      },
      execute: async ({ direction, deltaY }) => {
        let dy = deltaY;
        if (dy == null && direction) dy = direction === 'up' ? -900 : 900;
        if (dy == null || typeof dy !== 'number') throw new Error('scroll requires "direction" or numeric "deltaY"');
        return actionAndSnapshot((page) => page.scroll(dy));
      },
    },
    {
      name: 'select',
      description: 'Select a value in a dropdown/select element. Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from snapshot' },
          value: { type: 'string', description: 'Value or visible text to select' },
        },
        required: ['ref', 'value'],
      },
      execute: async ({ ref, value }) => actionAndSnapshot((page) => page.select(ref, value)),
    },
    {
      name: 'hover',
      description: 'Hover over an element by its ref. Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from snapshot' },
        },
        required: ['ref'],
      },
      execute: async ({ ref }) => actionAndSnapshot((page) => page.hover(ref)),
    },
    {
      name: 'back',
      description: 'Go back in browser history. Returns the updated snapshot.',
      parameters: { type: 'object', properties: {} },
      execute: async () => actionAndSnapshot((page) => page.goBack()),
    },
    {
      name: 'forward',
      description: 'Go forward in browser history. Returns the updated snapshot.',
      parameters: { type: 'object', properties: {} },
      execute: async () => actionAndSnapshot((page) => page.goForward()),
    },
    {
      name: 'drag',
      description: 'Drag one element to another by their refs. Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          fromRef: { type: 'string', description: 'Source element ref' },
          toRef: { type: 'string', description: 'Target element ref' },
        },
        required: ['fromRef', 'toRef'],
      },
      execute: async ({ fromRef, toRef }) => actionAndSnapshot((page) => page.drag(fromRef, toRef)),
    },
    {
      name: 'upload',
      description: 'Upload files to a file input element. Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'File input element ref' },
          files: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths' },
        },
        required: ['ref', 'files'],
      },
      execute: async ({ ref, files }) => actionAndSnapshot((page) => page.upload(ref, files)),
    },
    {
      name: 'tabs',
      description: 'List all open tabs. Returns JSON array of { index, url, title }.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const page = await getPage();
        const tabList = await page.tabs();
        return JSON.stringify(tabList, null, 2);
      },
    },
    {
      name: 'switchTab',
      description: 'Switch to a tab by index. Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Tab index (from tabs tool output)' },
        },
        required: ['index'],
      },
      execute: async ({ index }) => actionAndSnapshot((page) => page.switchTab(index)),
    },
    {
      name: 'pdf',
      description: 'Export current page as PDF. Returns base64-encoded PDF data.',
      parameters: {
        type: 'object',
        properties: {
          landscape: { type: 'boolean', description: 'Landscape orientation (default: false)' },
        },
      },
      execute: async (/** @type {{ landscape?: boolean }} */ { landscape } = {}) => {
        const page = await getPage();
        return await page.pdf({ landscape });
      },
    },
    {
      name: 'screenshot',
      description: 'Take a screenshot of the current page. Returns base64-encoded image.',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Image format (default: png)' },
        },
      },
      execute: async (/** @type {{ format?: string }} */ { format } = {}) => {
        const page = await getPage();
        return await page.screenshot({ format });
      },
    },
    {
      name: 'reload',
      description: 'Reload the current page. Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ignoreCache: { type: 'boolean', description: 'Bypass HTTP cache (hard reload). Default: false.' },
        },
      },
      execute: async (/** @type {{ ignoreCache?: boolean }} */ { ignoreCache } = {}) => actionAndSnapshot((page) => page.reload({ ignoreCache })),
    },
    {
      name: 'wait_for',
      description: 'Wait for visible text or a CSS selector to appear on the current page. Returns the updated snapshot once found.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Substring that must appear in document.body.innerText' },
          selector: { type: 'string', description: 'CSS selector that must match document.querySelector' },
          timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
        },
      },
      execute: async (/** @type {{ text?: string, selector?: string, timeout?: number }} */ { text, selector, timeout } = {}) => actionAndSnapshot((page) => page.waitFor({ text, selector, timeout })),
    },
    {
      name: 'downloads',
      description: 'List files captured via Content-Disposition: attachment downloads during this session. Returns JSON array of { url, suggestedFilename, savedPath, state, totalBytes, receivedBytes } per file.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const page = await getPage();
        return JSON.stringify(page.downloads.map((d) => ({ ...d })), null, 2);
      },
    },
    {
      name: 'extract',
      description:
        'Extract text or an attribute value from elements matching a CSS selector. ' +
        'Returns the first match by default, or an array of all matches with all=true. ' +
        'Use attr to read a property like href, src, value, or any data-* attribute instead of visible text.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector to match (e.g. "h1", ".price", "meta[name=description]")',
          },
          all: {
            type: 'boolean',
            description: 'Return all matches as an array instead of only the first (default: false)',
          },
          attr: {
            type: 'string',
            description: 'Property or attribute to read instead of innerText (e.g. "href", "src", "content")',
          },
        },
        required: ['selector'],
      },
      execute: async ({ selector, all, attr } = {}) => {
        const page = await getPage();
        return await page.extract(selector, { all, attr });
      },
    },

    {
      name: 'links',
      description:
        'Extract all hyperlinks from the current page. ' +
        'Returns an array of { href, text } objects, excluding javascript: and data: links. ' +
        'Useful for crawling, discovering navigation, or gathering URLs to visit next.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const page = await getPage();
        return await page.links();
      },
    },

    {
      name: 'table',
      description:
        'Extract an HTML table as structured JSON with headers and rows. ' +
        'Returns { headers: string[], rows: string[][] } or null if no table is found. ' +
        'Defaults to the first table on the page. Use selector to target a specific table. ' +
        'Useful for pricing tables, comparison charts, data grids, and financial data.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the table element (default: "table")',
          },
        },
        required: [],
      },
      execute: async ({ selector } = {}) => {
        const page = await getPage();
        return await page.table(selector || 'table');
      },
    },

    {
      name: 'text',
      description:
        'Extract all readable text from the current page as a plain string. ' +
        'Prefers the main content area (<main>, [role="main"], <article>) to automatically ' +
        'exclude navigation, headers, and footers. Falls back to stripping those elements ' +
        'from the full body. Useful when you need article content, product descriptions, ' +
        'or any body text that the ARIA snapshot does not capture.',
      parameters: {
        type: 'object',
        properties: {
          maxChars: {
            type: 'number',
            description:
              'Maximum characters to return. Excess is replaced with a truncation notice. ' +
              'Defaults to no limit.',
          },
        },
        required: [],
      },
      execute: async ({ maxChars } = {}) => {
        const page = await getPage();
        return await page.text({ maxChars });
      },
    },
  ];

  // Add assess tool if wearehere is installed
  if (assessFn) {
    tools.push({
      name: 'assess',
      description: 'Privacy assessment of a website. Returns risk score (0-100), per-category breakdown, concerns, and recommendation.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to assess' },
          timeout: { type: 'number', description: 'Navigation timeout in ms (default: 30000)' },
          settle: { type: 'number', description: 'Time to wait for trackers to load, in ms (default: 3000)' },
        },
        required: ['url'],
      },
      execute: async ({ url, timeout, settle }) => {
        const page = await connect(opts);
        try {
          const result = await assessFn(page, url, { timeout, settle });
          return JSON.stringify(result, null, 2);
        } finally {
          await page.close().catch(() => {});
        }
      },
    });
  }

  return {
    tools,
    async close() {
      if (_page) {
        await _page.close();
        _page = null;
      }
    },
  };
}
