/**
 * swiftagent.js — Tool adapter for agent loops (Anthropic, OpenAI, etc.)
 *
 * Usage:
 *   import { createBrowseTools } from 'swiftbrowse/swiftagent';
 *   const { tools, close } = createBrowseTools();
 *   // pass tools to your agent loop
 *   await close();
 *
 * Every action tool runs smartSettle() after the action:
 *   - Races Page.loadEventFired vs network-idle (200ms quiet window, 2.5s max)
 *   - Resolves the moment the page is stable — no fixed delays
 * Then returns a fresh snapshot so the LLM always sees the result.
 */

import { browse, connect } from './index.js';

/**
 * Wait for the page to become stable after an action.
 * Races navigation load event against network idle — whichever wins.
 * Never throws; safe to call after any action.
 * @param {object} page - Handle returned by connect()
 */
async function smartSettle(page) {
  await Promise.race([
    page.waitForNavigation(2500),
    page.waitForNetworkIdle({ timeout: 2500, idle: 200 }),
  ]).catch(() => {});
}

/**
 * Create swiftagent-compatible browse tools.
 *
 * @param {object} [opts] - Options forwarded to connect()
 * @param {'headless'|'headed'|'hybrid'} [opts.mode='headless']
 * @param {boolean} [opts.cookies=true] - Inject user's browser cookies
 * @param {boolean} [opts.consent=true] - Auto-dismiss cookie banners
 * @param {string}  [opts.browser] - Browser binary hint
 * @param {string}  [opts.viewport] - Viewport size e.g. "1280x720"
 * @param {string}  [opts.storageState] - Path to saved auth state JSON
 * @param {boolean} [opts.snapshotAfterAction=true] - Return snapshot after actions
 * @returns {{ tools: Array, close: () => Promise<void> }}
 */
export function createBrowseTools(opts = {}) {
  const snapshotAfterAction = opts.snapshotAfterAction !== false;
  let _page = null;

  async function getPage() {
    if (!_page) _page = await connect(opts);
    return _page;
  }

  /**
   * Run an action fn(page), settle, then optionally return a snapshot.
   * @param {(page: object) => Promise<void>} fn
   */
  async function act(fn) {
    const page = await getPage();
    await fn(page);
    await smartSettle(page);
    if (snapshotAfterAction) return await page.snapshot();
    return 'Action completed.';
  }

  /**
   * Search snapshot lines for the first element matching text (and optionally role).
   * Snapshot line format: `  - role "name" [props] [ref=N]`
   * @param {string} snapshotText
   * @param {string} text - Case-insensitive partial match against the line
   * @param {string} [role] - Optional ARIA role to narrow the match
   * @returns {{ ref: string, line: string } | { ref: null, message: string }}
   */
  function findInSnapshot(snapshotText, text, role) {
    const needle = text.toLowerCase();
    const roleNeedle = role ? role.toLowerCase() : null;
    for (const line of snapshotText.split('\n')) {
      const refMatch = line.match(/\[ref=(\w+)\]/);
      if (!refMatch) continue;
      const lower = line.toLowerCase();
      if (!lower.includes(needle)) continue;
      if (roleNeedle && !lower.includes(roleNeedle)) continue;
      return { ref: refMatch[1], line: line.trim() };
    }
    const qualifier = role ? ` with role "${role}"` : '';
    return { ref: null, message: `No element found matching "${text}"${qualifier}` };
  }

  const tools = [
    // ── Navigation ──────────────────────────────────────────────────────────

    {
      name: 'browse',
      description:
        'One-shot stateless browse: navigate to a URL and return a pruned ARIA snapshot. ' +
        'Launches its own isolated browser — does NOT share cookies or session state. ' +
        'Use goto instead whenever you need to preserve login state or act on the page.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL including scheme (https://...)' },
        },
        required: ['url'],
      },
      execute: async ({ url }) => await browse(url, opts),
    },

    {
      name: 'goto',
      description:
        'Navigate the current browser session to a URL. ' +
        'Preserves cookies, storage, and login state from previous actions. ' +
        'Waits for the page to fully load, then returns a pruned ARIA snapshot.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL including scheme (https://...)' },
        },
        required: ['url'],
      },
      execute: async ({ url }) => act((page) => page.goto(url)),
    },

    {
      name: 'back',
      description:
        'Go back to the previous page in browser history. ' +
        'Returns the updated snapshot. Throws if there is no previous page.',
      parameters: { type: 'object', properties: {} },
      execute: async () => act((page) => page.goBack()),
    },

    {
      name: 'forward',
      description:
        'Go forward to the next page in browser history. ' +
        'Returns the updated snapshot. Throws if there is no next page.',
      parameters: { type: 'object', properties: {} },
      execute: async () => act((page) => page.goForward()),
    },

    // ── Observation ─────────────────────────────────────────────────────────

    {
      name: 'snapshot',
      description:
        'Get the current page as a pruned ARIA accessibility tree. ' +
        'Returns a YAML-like tree where interactive elements have [ref=N] markers. ' +
        'Always call this after waitFor or waitForNavigation to refresh stale refs. ' +
        'Refs become invalid after any navigation — re-snapshot before acting.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const page = await getPage();
        return await page.snapshot();
      },
    },

    {
      name: 'find',
      description:
        'Find an element on the current page by visible text or ARIA label. ' +
        'Returns the ref of the first matching element. ' +
        'Optionally narrow by ARIA role (button, link, textbox, checkbox, combobox, etc.). ' +
        'Use this instead of scanning the snapshot yourself.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Visible text or ARIA label to search for (case-insensitive, partial match)',
          },
          role: {
            type: 'string',
            description: 'Optional ARIA role to narrow search (e.g. "button", "link", "textbox")',
          },
        },
        required: ['text'],
      },
      execute: async ({ text, role }) => {
        const page = await getPage();
        const snapshotText = await page.snapshot();
        return findInSnapshot(snapshotText, text, role);
      },
    },

    {
      name: 'screenshot',
      description:
        'Take a screenshot of the current page or a specific element. Returns base64-encoded image data. ' +
        'Use when visual context is needed that ARIA cannot express: charts, images, CAPTCHAs, layouts. ' +
        'Provide selector to crop to a specific element instead of the full page. ' +
        'Prefer snapshot for structured interaction; screenshot for visual inspection.',
      parameters: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['png', 'jpeg', 'webp'],
            description: 'Image format (default: png)',
          },
          selector: {
            type: 'string',
            description: 'CSS selector to crop the screenshot to a specific element (optional)',
          },
        },
      },
      execute: async ({ format, selector } = {}) => {
        const page = await getPage();
        return await page.screenshot({ format, selector });
      },
    },

    {
      name: 'pdf',
      description:
        'Export the current page as a PDF. Returns base64-encoded PDF data. ' +
        'Use for saving printable content, reports, or articles.',
      parameters: {
        type: 'object',
        properties: {
          landscape: {
            type: 'boolean',
            description: 'Landscape orientation (default: false)',
          },
        },
      },
      execute: async ({ landscape } = {}) => {
        const page = await getPage();
        return await page.pdf({ landscape });
      },
    },

    // ── Interaction ──────────────────────────────────────────────────────────

    {
      name: 'click',
      description:
        'Click an element by its [ref=N] from the snapshot. ' +
        'Returns the updated snapshot after the click and any resulting navigation or DOM update. ' +
        'For links: triggers navigation. For buttons: triggers the action. ' +
        'Refs expire after navigation — call snapshot again if the page changed.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from snapshot (the N in [ref=N])' },
        },
        required: ['ref'],
      },
      execute: async ({ ref }) => act((page) => page.click(ref)),
    },

    {
      name: 'type',
      description:
        'Type text into an input, textarea, or contenteditable element. ' +
        'Triggers keyboard and input events that React/Vue/Angular listen to. ' +
        'Set clear=true to replace existing content; omit to append. ' +
        'Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from snapshot' },
          text: { type: 'string', description: 'Text to type' },
          clear: {
            type: 'boolean',
            description: 'Clear existing content before typing (default: false)',
          },
        },
        required: ['ref', 'text'],
      },
      execute: async ({ ref, text, clear }) => act((page) => page.type(ref, text, { clear })),
    },

    {
      name: 'press',
      description:
        'Press a special keyboard key. Returns the updated snapshot. ' +
        'Common uses: Enter to submit forms, Tab to advance focus, ' +
        'Escape to close modals/dropdowns, ArrowDown/ArrowUp for list navigation.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            enum: [
              'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
              'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
              'Home', 'End', 'PageUp', 'PageDown', 'Space',
            ],
            description: 'Key to press',
          },
        },
        required: ['key'],
      },
      execute: async ({ key }) => act((page) => page.press(key)),
    },

    {
      name: 'hover',
      description:
        'Hover the mouse over an element to reveal tooltips, dropdown menus, or hover-triggered content. ' +
        'Returns the updated snapshot showing any newly revealed elements. ' +
        'Use before click when a menu only becomes visible on hover.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from snapshot' },
        },
        required: ['ref'],
      },
      execute: async ({ ref }) => act((page) => page.hover(ref)),
    },

    {
      name: 'select',
      description:
        'Select a value in a <select> dropdown or ARIA combobox. ' +
        'Matches by option value or visible text (case-sensitive). ' +
        'Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Ref of the select or combobox element' },
          value: { type: 'string', description: 'Option value or visible text to select' },
        },
        required: ['ref', 'value'],
      },
      execute: async ({ ref, value }) => act((page) => page.select(ref, value)),
    },

    {
      name: 'scroll',
      description:
        'Scroll the page vertically. Returns the updated snapshot, ' +
        'which may contain newly visible elements not in the previous snapshot. ' +
        'Positive deltaY scrolls down; negative scrolls up. Typical step: 400px.',
      parameters: {
        type: 'object',
        properties: {
          deltaY: {
            type: 'number',
            description: 'Pixels to scroll: positive=down, negative=up (e.g. 400)',
          },
        },
        required: ['deltaY'],
      },
      execute: async ({ deltaY }) => act((page) => page.scroll(deltaY)),
    },

    {
      name: 'drag',
      description:
        'Drag one element and drop it onto another. ' +
        'Use for reordering list items, moving kanban cards, or range slider controls. ' +
        'Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          fromRef: { type: 'string', description: 'Ref of the element to drag (source)' },
          toRef: { type: 'string', description: 'Ref of the element to drop onto (target)' },
        },
        required: ['fromRef', 'toRef'],
      },
      execute: async ({ fromRef, toRef }) => act((page) => page.drag(fromRef, toRef)),
    },

    {
      name: 'upload',
      description:
        'Upload files to a file input element. ' +
        'Provide absolute paths on the host machine. Returns the updated snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Ref of the file input element' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Absolute file paths to upload (e.g. ["/home/user/doc.pdf"])',
          },
        },
        required: ['ref', 'files'],
      },
      execute: async ({ ref, files }) => act((page) => page.upload(ref, files)),
    },

    // ── Waiting ──────────────────────────────────────────────────────────────

    {
      name: 'waitFor',
      description:
        'Wait until specific text or a CSS selector appears on the page. ' +
        'Use after triggering async operations (API calls, file loads, animations). ' +
        'Returns a fresh snapshot when the condition is met. Throws on timeout. ' +
        'More reliable than fixed sleep delays for dynamic content.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Wait until this text appears in the page body',
          },
          selector: {
            type: 'string',
            description: 'Wait until this CSS selector matches an element',
          },
          timeout: {
            type: 'number',
            description: 'Max wait time in ms (default: 10000)',
          },
        },
      },
      execute: async ({ text, selector, timeout = 10000 } = {}) => {
        const page = await getPage();
        await page.waitFor({ text, selector, timeout });
        return await page.snapshot();
      },
    },

    // ── Tabs ─────────────────────────────────────────────────────────────────

    {
      name: 'tabs',
      description:
        'List all open browser tabs. ' +
        'Returns an array of { index, url, title } objects. Use with switchTab.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const page = await getPage();
        return await page.tabs();
      },
    },

    {
      name: 'switchTab',
      description:
        'Switch to a different open tab by its index from the tabs tool. ' +
        'Returns the snapshot of the newly focused tab.',
      parameters: {
        type: 'object',
        properties: {
          index: {
            type: 'number',
            description: 'Tab index from the tabs tool (0-based)',
          },
        },
        required: ['index'],
      },
      execute: async ({ index }) => {
        const page = await getPage();
        await page.switchTab(index);
        await new Promise((r) => setTimeout(r, 300));
        return await page.snapshot();
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
