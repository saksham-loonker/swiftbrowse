#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Modified for SwiftBrowse; includes BareBrowse code. Attribution and changes: NOTICE.
/**
 * cli.js -- swiftbrowse CLI entry point.
 *
 * See `swiftbrowse` (no args) for full command reference.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const cmd = args[0];

// Hidden internal flag: --daemon-internal
if (args.includes('--daemon-internal')) {
  await runDaemonInternal();
} else if (cmd === 'mcp') {
  // Explicitly start the JSON-RPC loop — relying on the previous "isMain
  // auto-start" guard inside mcp-server.js would silently hang here because
  // process.argv[1] is cli.js, not mcp-server.js.
  const { runStdio } = await import('./mcp-server.js');
  runStdio();
} else if (cmd === 'install') {
  install();
} else if (cmd === 'doctor') {
  await doctor();
} else if (cmd === 'browse' && args[1]) {
  await oneShot();
} else if (cmd === 'open') {
  await cmdOpen();
} else if (cmd === 'close') {
  await cmdProxy('close');
} else if (cmd === 'status') {
  await cmdStatus();
} else if (cmd === 'goto' && args[1]) {
  await cmdProxy('goto', { url: args[1], timeout: parseFlag('--timeout') });
} else if (cmd === 'snapshot') {
  await cmdProxy('snapshot', { mode: parseFlag('--mode') });
} else if (cmd === 'text') {
  await cmdProxy('text', { maxChars: parseFlag('--max-chars') });
} else if (cmd === 'extract' && args[1]) {
  await cmdProxy('extract', { selector: args[1], all: hasFlag('--all'), attr: parseFlag('--attr') });
} else if (cmd === 'links') {
  await cmdProxy('links');
} else if (cmd === 'table') {
  await cmdProxy('table', { selector: args[1] && !args[1].startsWith('--') ? args[1] : undefined });
} else if (cmd === 'browse-batch') {
  await cmdBrowseBatch();
} else if (cmd === 'readable') {
  await cmdProxy('readable');
} else if (cmd === 'screenshot') {
  await cmdProxy('screenshot', { format: parseFlag('--format'), selector: parseFlag('--selector') });
} else if (cmd === 'click' && args[1]) {
  await cmdProxy('click', { ref: args[1] });
} else if (cmd === 'type' && args[1] && args[2]) {
  await cmdProxy('type', { ref: args[1], text: args.slice(2).filter(a => !a.startsWith('--')).join(' '), clear: hasFlag('--clear') });
} else if (cmd === 'fill' && args[1] && args[2]) {
  await cmdProxy('fill', { ref: args[1], text: args.slice(2).filter(a => !a.startsWith('--')).join(' ') });
} else if (cmd === 'press' && args[1]) {
  await cmdProxy('press', { key: args[1] });
} else if (cmd === 'scroll' && args[1]) {
  await cmdProxy('scroll', { deltaY: Number(args[1]) });
} else if (cmd === 'hover' && args[1]) {
  await cmdProxy('hover', { ref: args[1] });
} else if (cmd === 'select' && args[1] && args[2]) {
  await cmdProxy('select', { ref: args[1], value: args[2] });
} else if (cmd === 'eval' && args[1]) {
  await cmdProxy('eval', { expression: args.slice(1).join(' ') });
} else if (cmd === 'wait-idle') {
  await cmdProxy('wait-idle', { timeout: parseFlag('--timeout') });
} else if (cmd === 'console-logs') {
  await cmdProxy('console-logs', { level: parseFlag('--level'), clear: hasFlag('--clear') });
} else if (cmd === 'network-log') {
  await cmdProxy('network-log', { failed: hasFlag('--failed') });
} else if (cmd === 'back') {
  await cmdProxy('back');
} else if (cmd === 'forward') {
  await cmdProxy('forward');
} else if (cmd === 'reload') {
  await cmdProxy('reload', { ignoreCache: hasFlag('--no-cache') });
} else if (cmd === 'downloads') {
  await cmdProxy('downloads');
} else if (cmd === 'drag' && args[1] && args[2]) {
  await cmdProxy('drag', { fromRef: args[1], toRef: args[2] });
} else if (cmd === 'upload' && args[1] && args[2]) {
  await cmdProxy('upload', { ref: args[1], files: args.slice(2).filter(a => !a.startsWith('--')).map(f => resolve(f)) });
} else if (cmd === 'pdf') {
  await cmdProxy('pdf', { landscape: hasFlag('--landscape') });
} else if (cmd === 'tabs') {
  await cmdProxy('tabs');
} else if (cmd === 'tab' && args[1]) {
  await cmdProxy('tab', { index: Number(args[1]) });
} else if (cmd === 'wait-for') {
  await cmdProxy('wait-for', { text: parseFlag('--text'), selector: parseFlag('--selector'), timeout: parseFlag('--timeout') });
} else if (cmd === 'save-state') {
  await cmdProxy('save-state');
} else if (cmd === 'dialog-log') {
  await cmdProxy('dialog-log');
} else {
  printUsage();
}


// --- Command implementations ---

async function cmdOpen() {
  const { startDaemon } = await import('./src/daemon.js');
  const { isAlive } = await import('./src/session-client.js');
  const outputDir = resolve('.swiftbrowse');

  // Check for existing session
  if (await isAlive(outputDir)) {
    process.stdout.write('Session already running. Use `swiftbrowse close` first.\n');
    process.exit(1);
  }

  const url = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
  const opts = {
    engine: parseFlag('--engine'),
    mode: parseFlag('--mode') || 'headless',
    port: parseFlag('--port'),
    cookies: !hasFlag('--no-cookies'),
    incognito: hasFlag('--incognito') || undefined,
    browser: parseFlag('--browser'),
    timeout: parseFlag('--timeout'),
    pruneMode: parseFlag('--prune-mode') || 'act',
    consent: !hasFlag('--no-consent'),
    proxy: parseFlag('--proxy'),
    viewport: parseFlag('--viewport'),
    storageState: parseFlag('--storage-state'),
    downloadPath: parseFlag('--download-path'),
    blockAds: hasFlag('--no-block-ads') ? false : undefined,
    blockUrls: parseFlagAll('--block-urls'),
    blockPrivateNetwork: hasFlag('--block-private-network') || undefined,
    uploadDir: parseFlag('--upload-dir') ? resolve(parseFlag('--upload-dir')) : undefined,
  };

  try {
    const session = await startDaemon(opts, outputDir, url);
    process.stdout.write(`Session started (pid ${session.pid}, port ${session.port})\n`);
    if (url) process.stdout.write(`Navigated to ${url}\n`);
    process.stdout.write(`Output dir: ${outputDir}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function cmdStatus() {
  const { readSession, isAlive } = await import('./src/session-client.js');
  const outputDir = resolve('.swiftbrowse');
  const session = readSession(outputDir);

  if (!session) {
    process.stdout.write('No session found.\n');
    process.exit(1);
  }

  const alive = await isAlive(outputDir);
  if (alive) {
    process.stdout.write(`Session running (pid ${session.pid}, port ${session.port}, started ${session.startedAt})\n`);
  } else {
    process.stdout.write(`Session stale (pid ${session.pid} not responding). Run \`swiftbrowse close\` to clean up.\n`);
    process.exit(1);
  }
}

async function cmdProxy(command, cmdArgs) {
  const { sendCommand, readSession } = await import('./src/session-client.js');
  const { unlinkSync } = await import('node:fs');
  const outputDir = resolve('.swiftbrowse');

  try {
    const result = await sendCommand(command, cmdArgs, outputDir);

    if (!result.ok) {
      process.stderr.write(`Error: ${result.error}\n`);
      process.exit(1);
    }

    // Print result
    if (result.file && result.count !== undefined) {
      process.stdout.write(`${result.file} (${result.count} entries)\n`);
    } else if (result.file) {
      process.stdout.write(`${result.file}\n`);
    } else if (result.value !== undefined) {
      process.stdout.write(JSON.stringify(result.value) + '\n');
    } else if (command === 'close') {
      // Clean up session.json in case daemon didn't
      const sessionPath = join(outputDir, 'session.json');
      try { unlinkSync(sessionPath); } catch { /* already gone */ }
      process.stdout.write('Session closed.\n');
    } else {
      process.stdout.write('ok\n');
    }
  } catch (err) {
    if (command === 'close') {
      // Daemon may have exited before responding — that's fine
      const sessionPath = join(outputDir, 'session.json');
      try { unlinkSync(sessionPath); } catch { /* already gone */ }
      process.stdout.write('Session closed.\n');
    } else {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
    }
  }
}

function browseOptions() {
  return {
    engine: parseFlag('--engine'), mode: parseFlag('--mode') || 'headless',
    incognito: hasFlag('--incognito'), cookies: !hasFlag('--no-cookies'),
    consent: !hasFlag('--no-consent'), browser: parseFlag('--browser'),
    timeout: parseFlag('--timeout') ? Number(parseFlag('--timeout')) : undefined,
    proxy: parseFlag('--proxy'), viewport: parseFlag('--viewport'),
    pruneMode: parseFlag('--prune-mode') || 'act',
    blockAds: !hasFlag('--no-block-ads'), blockUrls: parseFlagAll('--block-urls'),
    blockPrivateNetwork: hasFlag('--block-private-network'),
  };
}

async function oneShot() {
  const { browse } = await import('./src/index.js');
  const url = args[1];
  const options = browseOptions();
  if (args[2] && !args[2].startsWith('--')) options.mode = args[2];
  try {
    const snapshot = await browse(url, options);
    process.stdout.write(snapshot + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function cmdBrowseBatch() {
  const { browse } = await import('./src/index.js');

  // Collect URLs from positional args and/or --file=urls.txt
  const valuedFlags = new Set(['--file', '--mode', '--engine', '--timeout', '--browser', '--proxy', '--viewport', '--prune-mode', '--block-urls']);
  const urls = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && valuedFlags.has(arg)) i++;
    } else urls.push(arg);
  }
  const filePath = parseFlag('--file');
  if (filePath) {
    const lines = readFileSync(filePath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    urls.push(...lines);
  }

  if (urls.length === 0) {
    process.stderr.write('Error: no URLs provided\nUsage: swiftbrowse browse-batch url1 url2 ... [--file=urls.txt]\n');
    process.exit(1);
  }

  const outputDir = resolve('.swiftbrowse');
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const options = browseOptions();

  let ok = 0;
  for (const url of urls) {
    try {
      const snapshot = await browse(url, options);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const outFile = join(outputDir, `batch-${ts}.yml`);
      writeFileSync(outFile, snapshot, { mode: 0o600 });
      ok++;
      process.stdout.write(`ok  ${url}\n    ${outFile}\n`);
    } catch (err) {
      process.stderr.write(`err ${url}\n    ${err.message}\n`);
    }
  }
  process.stdout.write(`\n${ok}/${urls.length} succeeded\n`);
  if (ok !== urls.length) process.exitCode = 1;
}

async function runDaemonInternal() {
  const { runDaemon } = await import('./src/daemon.js');
  const opts = {
    engine: parseFlag('--engine'),
    mode: parseFlag('--mode') || 'headless',
    port: parseFlag('--port'),
    cookies: !hasFlag('--no-cookies'),
    incognito: hasFlag('--incognito') || undefined,
    browser: parseFlag('--browser'),
    timeout: parseFlag('--timeout'),
    pruneMode: parseFlag('--prune-mode') || 'act',
    consent: !hasFlag('--no-consent'),
    proxy: parseFlag('--proxy'),
    viewport: parseFlag('--viewport'),
    storageState: parseFlag('--storage-state'),
    downloadPath: parseFlag('--download-path'),
    blockAds: hasFlag('--no-block-ads') ? false : undefined,
    blockUrls: parseFlagAll('--block-urls'),
    blockPrivateNetwork: hasFlag('--block-private-network') || undefined,
    uploadDir: parseFlag('--upload-dir'),
  };
  const outputDir = parseFlag('--output-dir') || resolve('.swiftbrowse');
  const url = parseFlag('--url');
  await runDaemon(opts, outputDir, url || undefined);
}


// --- Flag parsing helpers ---

function parseFlag(name) {
  // --name=value or --name value
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(name + '=')) return args[i].slice(name.length + 1);
    if (args[i] === name && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  }
  return undefined;
}

function hasFlag(name) {
  return args.includes(name);
}

// Collects every occurrence of a repeatable flag (--name=val or --name val).
// Returns undefined when absent so the opts object stays sparse and callers
// can distinguish "not provided" from "provided but empty".
function parseFlagAll(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(name + '=')) out.push(args[i].slice(name.length + 1));
    else if (args[i] === name && args[i + 1] && !args[i + 1].startsWith('--')) {
      out.push(args[i + 1]); i++;
    }
  }
  return out.length ? out : undefined;
}


// --- MCP auto-installer ---

function install() {
  // Handle --skill flag
  if (hasFlag('--skill')) {
    installSkill();
    return;
  }

  const mcpEntry = {
    command: 'npx',
    args: ['swiftbrowse', 'mcp'],
  };

  const targets = detectTargets();

  if (targets.length === 0) {
    console.log('No MCP clients detected.\n');
  }

  let installed = 0;

  for (const target of targets) {
    try {
      const config = readJsonOrEmpty(target.path);
      if (!config.mcpServers) config.mcpServers = {};

      if (config.mcpServers.swiftbrowse) {
        // Detect a stale entry pointing at a different location/command —
        // common when a contributor has both a global install (`npx`) and
        // a worktree-local entry (`node /abs/path/mcp-server.js`). OAuth
        // tokens are stored per endpoint, so leaving the stale one means
        // auth from one path silently won't carry over to the other.
        const existing = config.mcpServers.swiftbrowse;
        const sameEndpoint =
          existing.command === mcpEntry.command &&
          JSON.stringify(existing.args || []) === JSON.stringify(mcpEntry.args);
        if (!sameEndpoint) {
          if (hasFlag('--force')) {
            config.mcpServers.swiftbrowse = mcpEntry;
            writeFileSync(target.path, JSON.stringify(config, null, 2) + '\n');
            console.log(`  ${target.name}: REPLACED stale entry`);
            console.log(`    was: ${existing.command} ${(existing.args || []).join(' ')}`);
            console.log(`    now: ${mcpEntry.command} ${mcpEntry.args.join(' ')}`);
            installed++;
          } else {
            console.log(`  ${target.name}: CONFLICT — different endpoint already registered`);
            console.log(`    existing: ${existing.command} ${(existing.args || []).join(' ')}`);
            console.log(`    new:      ${mcpEntry.command} ${mcpEntry.args.join(' ')}`);
            console.log(`    Pass --force to overwrite, or edit ${target.path} by hand.`);
          }
        } else {
          console.log(`  ${target.name}: already configured`);
          installed++;
        }
        continue;
      }

      config.mcpServers.swiftbrowse = mcpEntry;

      const dir = join(target.path, '..');
      mkdirSync(dir, { recursive: true });

      writeFileSync(target.path, JSON.stringify(config, null, 2) + '\n');
      console.log(`  ${target.name}: installed -> ${target.path}`);
      installed++;
    } catch (err) {
      console.log(`  ${target.name}: failed (${err.message})`);
    }
  }

  if (installed > 0) {
    console.log(`\nDone. Restart your MCP client to pick up the new server.`);
  }

  // Always print Claude Code hint (it uses `claude mcp add`, not JSON config)
  console.log(`\nClaude Code: run this instead of install:`);
  console.log(`  claude mcp add swiftbrowse -- npx swiftbrowse mcp\n`);
}

function installSkill() {
  const thisDir = fileURLToPath(new URL('.', import.meta.url));
  const src = join(thisDir, 'commands', 'swiftbrowse', 'SKILL.md');

  if (!existsSync(src)) {
    console.error('SKILL.md not found in package. Reinstall swiftbrowse.');
    process.exit(1);
  }

  const dest = join(homedir(), '.config', 'claude', 'skills', 'swiftbrowse', 'SKILL.md');
  const destDir = join(dest, '..');
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  console.log(`Skill installed: ${dest}`);
  console.log('Claude Code will now see swiftbrowse as an available skill.');
}

function detectTargets() {
  const home = homedir();
  const os = platform();
  const targets = [];

  // Claude Desktop
  let claudeDesktop;
  if (os === 'darwin') {
    claudeDesktop = join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (os === 'linux') {
    claudeDesktop = join(home, '.config', 'Claude', 'claude_desktop_config.json');
  } else if (os === 'win32') {
    claudeDesktop = join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  }
  if (claudeDesktop) {
    const dir = join(claudeDesktop, '..');
    if (existsSync(dir)) {
      targets.push({ name: 'Claude Desktop', path: claudeDesktop });
    }
  }

  // Cursor
  const cursorDir = join(home, '.cursor');
  if (existsSync(cursorDir)) {
    targets.push({ name: 'Cursor', path: join(cursorDir, 'mcp.json') });
  }

  return targets;
}

function readJsonOrEmpty(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Scan every known MCP config location for a `swiftbrowse` entry and print
 * what's there. Built for the Claude Code "Conflicting scopes" warning,
 * which is generated when the same MCP server name resolves to different
 * absolute endpoints across scopes — OAuth tokens are stored per-endpoint
 * so a split silently breaks auth.
 */
async function doctor() {
  await doctorEnvironment();
  doctorMcpConfig();
}

/**
 * Report the runtime environment: which engine/mode a session would use, which
 * browsers and cookie sources are actually installed, and whether a session is
 * live in this directory. This is the "which engine am I on and what can it do?"
 * answer — the gap that led a peer session to conclude Firefox wasn't supported
 * when it is (selected via SWIFTBROWSE_ENGINE / --engine, not a per-tool flag).
 */
async function doctorEnvironment() {
  const { findBrowser } = await import('./src/chromium.js');
  const { findFirefox } = await import('./src/firefox.js');
  const { findChromiumCookieDb, findFirefoxCookieDb } = await import('./src/auth.js');

  console.log('swiftbrowse doctor — runtime environment:\n');
  console.log(`  Node ${process.version} on ${platform()}`);

  // Configured engine/mode/incognito. MCP selects the engine at server launch
  // via these env vars (mcp-server.js), which a running session can't see —
  // surfacing them here is the whole point.
  const engine = (process.env.SWIFTBROWSE_ENGINE ?? process.env.BAREBROWSE_ENGINE) === 'firefox' ? 'firefox' : 'chromium';
  const modeEnv = (process.env.SWIFTBROWSE_MODE ?? process.env.BAREBROWSE_MODE);
  const incognito = (process.env.SWIFTBROWSE_INCOGNITO ?? process.env.BAREBROWSE_INCOGNITO) === '1';
  console.log(`  Default engine: ${engine}  (override: SWIFTBROWSE_ENGINE=firefox | --engine firefox | connect({engine}))`);
  // Mode default differs by surface: CLI `open` → headless, MCP → hybrid.
  // SWIFTBROWSE_MODE overrides both, so report it directly when set.
  console.log(`  Default mode:   ${modeEnv ? `${modeEnv}  (SWIFTBROWSE_MODE)` : 'headless (CLI open) / hybrid (MCP)'}`);
  console.log(`  Incognito:      ${incognito ? 'on (SWIFTBROWSE_INCOGNITO=1) — no cookie injection' : 'off'}`);

  // Installed browsers — both engines. A missing one explains why an --engine
  // choice would fail before it launches.
  console.log('\n  Installed browsers:');
  let chromiumPath = null, firefoxPath = null;
  try { chromiumPath = findBrowser(); } catch { /* none */ }
  try { firefoxPath = findFirefox(); } catch { /* none */ }
  console.log(`    Chromium/CDP:  ${chromiumPath || 'NOT FOUND — install chrome/chromium/brave/edge'}`);
  console.log(`    Firefox/BiDi:  ${firefoxPath || 'NOT FOUND — install firefox (>= 121 for stable BiDi)'}`);

  // Cookie sources — where authenticated sessions come from (skipped in incognito).
  console.log('\n  Cookie sources:');
  const chromiumCookies = findChromiumCookieDb();
  const firefoxCookies = findFirefoxCookieDb();
  console.log(`    Chromium:  ${chromiumCookies ? `${chromiumCookies.browser} (${chromiumCookies.path})` : 'none found'}`);
  console.log(`    Firefox:   ${firefoxCookies || 'none found'}`);

  // Live session in this directory, if any — reports its actual engine +
  // capabilities (persisted into session.json by the daemon).
  const { readSession, isAlive } = await import('./src/session-client.js');
  const outputDir = resolve('.swiftbrowse');
  const session = readSession(outputDir);
  console.log('\n  Active session (this directory):');
  if (!session) {
    console.log('    none — run `swiftbrowse open [url]` to start one');
  } else if (!(await isAlive(outputDir))) {
    console.log(`    stale (pid ${session.pid} not responding) — run \`swiftbrowse close\` to clean up`);
  } else {
    console.log(`    running (pid ${session.pid}, port ${session.port}, engine ${session.engine || 'chromium'})`);
    if (session.capabilities) {
      const c = session.capabilities;
      console.log(`      mode=${c.mode} attach=${c.attach} downloads=${c.downloads} stealth=${c.stealth} cookies=${c.cookieInjection} reloadIgnoreCache=${c.reloadIgnoreCache}`);
    }
  }
  console.log('');
}

function doctorMcpConfig() {
  const home = homedir();
  const cwd = process.cwd();
  const os = platform();

  // (label, file path, key) — `key` is the top-level config key that holds
  // the servers map. Claude Code / Desktop / Cursor use `mcpServers`; VS
  // Code's .vscode/mcp.json uses `servers`.
  const locations = [
    ['Claude Code (user)',    join(home, '.claude.json'),      'mcpServers'],
    ['Claude Code (project)', join(cwd, '.mcp.json'),          'mcpServers'],
    ['Claude Code (local)',   join(cwd, '.claude.json'),       'mcpServers'],
    ['VS Code (project)',     join(cwd, '.vscode', 'mcp.json'), 'servers'],
    ['Cursor (user)',         join(home, '.cursor', 'mcp.json'), 'mcpServers'],
  ];
  // Claude Desktop varies by OS
  if (os === 'darwin') {
    locations.push(['Claude Desktop', join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), 'mcpServers']);
  } else if (os === 'linux') {
    locations.push(['Claude Desktop', join(home, '.config', 'Claude', 'claude_desktop_config.json'), 'mcpServers']);
  } else if (os === 'win32') {
    locations.push(['Claude Desktop', join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), 'mcpServers']);
  }

  console.log('swiftbrowse doctor — scanning known MCP config locations:\n');
  const findings = [];
  for (const [label, path, key] of locations) {
    if (!existsSync(path)) {
      console.log(`  - ${label.padEnd(22)} ${path}  (not present)`);
      continue;
    }
    const cfg = readJsonOrEmpty(path);
    const entry = cfg[key]?.swiftbrowse;
    if (!entry) {
      console.log(`  - ${label.padEnd(22)} ${path}  (no swiftbrowse entry)`);
      continue;
    }
    const sig = `${entry.command || '?'} ${(entry.args || []).join(' ')}`;
    console.log(`  ✓ ${label.padEnd(22)} ${path}`);
    console.log(`      endpoint: ${sig}`);
    findings.push({ label, path, sig });
  }

  if (findings.length <= 1) {
    console.log(`\n${findings.length} registration${findings.length === 1 ? '' : 's'} found. No scope conflict.`);
  } else {
    const unique = new Set(findings.map((f) => f.sig));
    if (unique.size === 1) {
      console.log(`\n${findings.length} registrations found, all pointing at the same endpoint. No conflict.`);
    } else {
      console.log(`\n⚠ CONFLICT: ${findings.length} registrations across ${unique.size} different endpoints.`);
      console.log(`  Claude Code stores OAuth tokens per endpoint — authenticating in one scope`);
      console.log(`  will not carry over to the other. Recommended fix: keep one, remove the rest.\n`);
      console.log(`  Claude Code: claude mcp remove swiftbrowse -s user   (or -s project / -s local)`);
      console.log(`  Other clients: edit the JSON file shown above and delete the swiftbrowse key.\n`);
      console.log(`  Tip: run \`swiftbrowse mcp\` directly to see the startup banner —`);
      console.log(`  the absolute serving path it prints to stderr is the one currently in use.`);
    }
  }
}


// --- Usage ---

function printUsage() {
  process.stdout.write(`swiftbrowse -- CDP-direct browsing for autonomous agents

Session:
  swiftbrowse open [url] [flags]     Open browser session
  swiftbrowse close                  Close session
  swiftbrowse status                 Check session status

  Open flags:
    --engine=chromium|firefox       Browser engine (default: chromium/CDP;
                                    firefox drives over WebDriver BiDi)
    --mode=headless|headed|hybrid   Browser mode (default: headless;
                                    hybrid works on both engines)
    --port=N                        CDP port for headed mode
    --no-cookies                    Skip cookie injection
    --incognito                     Clean, unauthenticated session (skip all auth injection)
    --browser=firefox|chromium      Cookie source browser
    --timeout=N                     Navigation timeout in ms
    --prune-mode=act|read           Default pruning mode
    --no-consent                    Skip consent dismissal
    --proxy=URL                     HTTP/SOCKS proxy server
    --viewport=WxH                  Viewport size (e.g. 1280x720)
    --storage-state=FILE            Load cookies/localStorage from JSON file
    --download-path=DIR             Directory for downloaded files (default: per-session temp dir)
    --no-block-ads                  Disable the built-in ad/tracker blocklist (~120 patterns).
                                    Default: enabled in owned-browser modes, disabled in attach mode.
    --block-urls=PATTERN            Extra URL glob to block (repeatable, e.g. --block-urls='*://*.foo.com/*').
                                    Use the =VALUE form when the pattern could be mistaken for a flag.
    --block-private-network         SSRF guard: refuse to navigate to loopback / RFC-1918 / link-local /
                                    cloud-metadata hosts. Off by default so localhost browsing works.
    --upload-dir=DIR                Sandbox uploads: reject files outside DIR (symlinks resolved).
                                    Default: no restriction. (file:/chrome: schemes are always blocked.)

Navigation:
  swiftbrowse goto <url>             Navigate to URL
  swiftbrowse back                   Go back in history
  swiftbrowse forward                Go forward in history
  swiftbrowse reload [--no-cache]    Reload current page
  swiftbrowse snapshot [--mode=M]    ARIA snapshot -> .swiftbrowse/page-*.yml
  swiftbrowse readable               Clean article text -> .swiftbrowse/article-*.txt
  swiftbrowse screenshot [--format]  Screenshot -> .swiftbrowse/screenshot-*.png
  swiftbrowse pdf [--landscape]      PDF export -> .swiftbrowse/page-*.pdf

Interaction:
  swiftbrowse click <ref>            Click element
  swiftbrowse type <ref> <text>      Type text (--clear to replace)
  swiftbrowse fill <ref> <text>      Clear + type
  swiftbrowse press <key>            Press key (Enter, Tab, Escape, ...)
  swiftbrowse scroll <deltaY>        Scroll (positive=down)
  swiftbrowse hover <ref>            Hover element
  swiftbrowse select <ref> <value>   Select dropdown value
  swiftbrowse drag <from> <to>       Drag element to another
  swiftbrowse upload <ref> <files..> Upload files to file input

Tabs:
  swiftbrowse tabs                   List open tabs
  swiftbrowse tab <index>            Switch to tab by index

Debugging:
  swiftbrowse eval <expression>      Run JS in page context
  swiftbrowse wait-idle [--timeout]  Wait for network idle
  swiftbrowse wait-for [opts]        Wait for text/selector to appear
    --text=STRING                   Wait for text in page body
    --selector=CSS                  Wait for CSS selector to match
    --timeout=N                     Max wait time in ms (default: 30000)
  swiftbrowse console-logs           Console logs -> .swiftbrowse/console-*.json
  swiftbrowse network-log            Network log -> .swiftbrowse/network-*.json
  swiftbrowse dialog-log             JS dialog log -> .swiftbrowse/dialogs-*.json
  swiftbrowse downloads              List Content-Disposition downloads + savedPath (JSON)
  swiftbrowse save-state             Cookies + localStorage -> .swiftbrowse/state-*.json

One-shot:
  swiftbrowse browse <url> [mode]    Browse + print snapshot to stdout

MCP:
  swiftbrowse mcp                    Start MCP server (JSON-RPC over stdio)
  swiftbrowse install [--force]      Add swiftbrowse to detected MCP clients (--force replaces stale entries)
  swiftbrowse install --skill        Install Claude Code skill file
  swiftbrowse doctor                 Report engine/mode/browsers/cookie sources + active session,
                                    then scan MCP config locations + flag scope conflicts
  swiftbrowse install                Auto-configure MCP for Claude Desktop / Cursor
  swiftbrowse install --skill        Install SKILL.md for Claude Code

As a library:
  import { browse, connect } from 'swiftbrowse';

Extraction: text [--max-chars=N], extract <selector> [--all] [--attr=NAME], links, table [selector]
Batch: swiftbrowse browse-batch <url>... [--file=urls.txt] [--engine=firefox]
Screenshots: --selector=CSS crops to the matching element
More: see README.md or commands/swiftbrowse.md
`);
}
