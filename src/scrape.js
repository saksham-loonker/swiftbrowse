/** Structured extraction shared by CDP and BiDi. Expressions contain JSON-encoded arguments only. */

/**
 * @param {(expression: string) => Promise<any>} evaluate
 */
export function createScrapingTools(evaluate) {
  const run = (fn, ...args) => evaluate(`(${fn.toString()})(${args.map(v => JSON.stringify(v)).join(',')})`);
  return {
    /** @param {{maxChars?: number}} [opts] @returns {Promise<string>} */
    async text(opts = {}) {
      if (opts.maxChars !== undefined && (!Number.isInteger(opts.maxChars) || opts.maxChars < 0)) {
        throw new Error('maxChars must be a non-negative integer');
      }
      let text = await run(() => {
        const main = document.querySelector('main, [role="main"], article');
        if (main) return /** @type {HTMLElement} */ (main).innerText;
        if (!document.body) return '';
        const clone = document.body.cloneNode(true);
        // Filter hidden content using its live counterpart before reading the clone.
        const originals = [document.body, ...document.body.querySelectorAll('*')];
        const copies = [clone, .../** @type {Element} */ (clone).querySelectorAll('*')];
        originals.forEach((el, i) => {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') /** @type {ChildNode} */ (copies[i]).remove();
        });
        /** @type {Element} */ (clone).querySelectorAll('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], script, style, noscript').forEach(el => el.remove());
        return clone.textContent || '';
      });
      text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (opts.maxChars !== undefined && text.length > opts.maxChars) {
        text = text.slice(0, opts.maxChars) + `\n\n[...${text.length - opts.maxChars} more chars truncated]`;
      }
      return text;
    },

    /** @param {string} selector @param {{all?: boolean, attr?: string}} [opts] @returns {Promise<string|string[]|null>} */
    async extract(selector, opts = {}) {
      return run((sel, all, attr) => {
        const read = el => {
          const value = el[attr];
          return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? String(value) : el.getAttribute(attr);
        };
        if (all) return Array.from(document.querySelectorAll(sel), read);
        const el = document.querySelector(sel);
        return el ? read(el) : null;
      }, selector, !!opts.all, opts.attr || 'innerText');
    },

    /** @param {string} [selector] @returns {Promise<{headers: string[], rows: string[][]}|null>} */
    async table(selector = 'table') {
      return run(sel => {
        const table = document.querySelector(sel);
        if (!(table instanceof HTMLTableElement)) return null;
        const allRows = Array.from(table.rows);
        const cells = row => Array.from(row.cells, cell => cell.innerText.trim());
        let headers = Array.from(table.querySelectorAll('thead th, thead td'), c => /** @type {HTMLElement} */ (c).innerText.trim());
        const rows = headers.length ? allRows.filter(r => !r.closest('thead')) : allRows.slice(1);
        if (!headers.length && allRows.length) headers = cells(allRows[0]);
        return { headers, rows: rows.map(cells) };
      }, selector);
    },

    /** @returns {Promise<Array<{href: string, text: string}>>} */
    async links() {
      return run(() => Array.from(document.querySelectorAll('a[href]'), a => ({
        href: /** @type {HTMLAnchorElement} */ (a).href,
        text: (/** @type {HTMLElement} */ (a).innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '),
      })).filter(a => a.href && !/^(javascript|data):/i.test(a.href)));
    },
  };
}
