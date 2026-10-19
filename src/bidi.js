// SPDX-License-Identifier: Apache-2.0
// Modified for SwiftBrowse; includes BareBrowse code. Attribution and changes: NOTICE.
/**
 * bidi.js — Minimal WebDriver BiDi client over WebSocket (Firefox transport).
 *
 * The W3C-standard successor to CDP. CDP was deprecated in Firefox, so Firefox
 * is driven over BiDi instead. This is the BiDi analogue of cdp.js: same
 * JSON-RPC-over-WebSocket shape (id/method/params → result), same `ws`
 * dependency and 256 MB maxPayload (a full AX snapshot of a large page is
 * returned as one big string from script.evaluate — see ax-snapshot.js — and
 * would blow the built-in WebSocket cap exactly as getFullAXTree did on CDP).
 *
 * Differences from CDP that shape this client:
 *   - A session must be created explicitly (`session.new`) before any command.
 *   - Events must be subscribed to (`session.subscribe`); we lean on
 *     command results (navigate's `wait:'complete'`) instead where possible.
 *   - Errors arrive as `{ type:'error', error, message }`, not `{ error:{} }`.
 *   - Everything is scoped by `context` (a browsing-context id), not sessionId.
 */

import WebSocket from 'ws';

/** Lift the message ceiling well past any realistic AX/DOM payload. */
const MAX_PAYLOAD = 256 * 1024 * 1024; // 256 MB

/**
 * Create a BiDi client connected to the given /session WebSocket URL and open
 * a session. Firefox prints its BiDi endpoint to stderr as
 * "WebDriver BiDi listening on ws://HOST:PORT"; the direct-connection socket
 * (no WebDriver-classic handshake) lives at that URL + "/session".
 *
 * @param {string} wsUrl - BiDi session WebSocket URL (ws://HOST:PORT/session)
 * @returns {Promise<object>} BiDi client ({ send, evaluate, on, once, subscribe, sessionId, close })
 */
export async function createBiDi(wsUrl, { commandTimeout = 60000 } = {}) {
  const ws = new WebSocket(wsUrl, { maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
  let nextId = 1;
  const pending = new Map();   // id → { resolve, reject }
  const listeners = new Map(); // "method" → Set<callback>
  const eventWaits = new Set();
  const failAll = error => {
    for (const handler of pending.values()) handler.reject(error);
    pending.clear();
    for (const cancel of [...eventWaits]) cancel(error);
  };

  /** @type {Promise<void>} */
  const connected = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('BiDi connection timeout (5s)'));
    }, 5000);
    ws.onopen = () => { clearTimeout(timeout); resolve(); };
    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error(`BiDi WebSocket connection failed: ${e.message || 'unknown error'}`));
    };
  });
  try { await connected; } catch (error) { ws.terminate(); throw error; }

  ws.onmessage = (event) => {
    const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());

    // Command response (has id + type 'success' | 'error')
    if (msg.id !== undefined && pending.has(msg.id)) {
      const handler = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.type === 'error') {
        handler.reject(new Error(`BiDi error: ${msg.error} — ${msg.message || ''}`.trim()));
      } else {
        handler.resolve(msg.result);
      }
      return;
    }

    // Event (type 'event', has method + params)
    if (msg.type === 'event' && msg.method) {
      const set = listeners.get(msg.method);
      if (set) for (const cb of set) cb(msg.params);
    }
  };

  ws.onerror = event => failAll(new Error(`BiDi WebSocket error: ${event.message || 'unknown'}`));
  ws.onclose = () => failAll(new Error('BiDi WebSocket closed'));

  const client = {
    /**
     * Send a BiDi command and wait for its result.
     * @param {string} method - e.g. 'browsingContext.navigate'
     * @param {object} [params]
     * @returns {Promise<object>} result
     */
    send(method, params = {}) {
      if (ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('BiDi WebSocket closed'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`BiDi command timed out: ${method}`));
        }, commandTimeout);
        pending.set(id, {
          resolve: result => { clearTimeout(timer); resolve(result); },
          reject: error => { clearTimeout(timer); reject(error); },
        });
        ws.send(JSON.stringify({ id, method, params }), error => {
          if (!error) return;
          pending.get(id)?.reject(error);
          pending.delete(id);
        });
      });
    },

    /**
     * Evaluate an expression in a browsing context and return its value.
     * Throws on an in-page exception (BiDi reports these as a `success`
     * envelope with `type:'exception'`, unlike a protocol error).
     * @param {string} context - browsing-context id
     * @param {string} expression - JS source to evaluate
     * @param {boolean} [awaitPromise=true]
     * @returns {Promise<*>} the deserialized primitive value (result.value)
     */
    async evaluate(context, expression, awaitPromise = true) {
      const res = await client.send('script.evaluate', {
        expression, target: { context }, awaitPromise,
      });
      if (res.type === 'exception') {
        const d = res.exceptionDetails;
        throw new Error(`BiDi script exception: ${d?.text || d?.exception?.value || 'unknown'}`);
      }
      return res.result?.value;
    },

    /** Subscribe to BiDi events by method name (required before events fire). */
    async subscribe(events) {
      await client.send('session.subscribe', { events });
    },

    /** Register an event listener. Returns an unsubscribe function. */
    on(method, callback) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(callback);
      return () => listeners.get(method)?.delete(callback);
    },

    /** Resolve once a named event fires (or reject on timeout). */
    once(method, timeout = 30000) {
      if (ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('BiDi WebSocket closed'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => cancel(new Error(`Timeout waiting for BiDi event: ${method}`)), timeout);
        const unsub = client.on(method, params => {
          clearTimeout(timer);
          unsub();
          eventWaits.delete(cancel);
          resolve(params);
        });
        const cancel = error => {
          clearTimeout(timer);
          unsub();
          eventWaits.delete(cancel);
          reject(error);
        };
        eventWaits.add(cancel);
      });
    },

    sessionId: null,
    close() {
      failAll(new Error('BiDi WebSocket closed'));
      listeners.clear();
      ws.terminate();
    },
  };

  // Open the session. unhandledPromptBehavior:'ignore' stops Firefox from
  // auto-dismissing JS dialogs (alert/confirm/prompt) before we can handle them
  // — without it, browsingContext.handleUserPrompt loses the race and fails
  // with "no such alert" (measured). firefox-page.js wires a userPromptOpened
  // handler before any navigation, so no dialog is ever left hanging.
  let session;
  try {
    session = await client.send('session.new', {
      capabilities: { alwaysMatch: { unhandledPromptBehavior: 'ignore' } },
    });
  } catch (error) {
    client.close();
    throw error;
  }
  client.sessionId = session.sessionId;
  client.capabilities = session.capabilities;
  return client;
}
