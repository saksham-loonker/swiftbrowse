// Fail before tests acquire HTTP servers when a runner has unusable browsers.
import { execFileSync } from 'node:child_process';
import { findBrowser, launch, cleanupBrowser } from '../src/chromium.js';
import { findFirefox, launchFirefox, cleanupFirefox } from '../src/firefox.js';
import { createCDP } from '../src/cdp.js';
import { createBiDi } from '../src/bidi.js';

for (const engine of ['chromium', 'firefox']) {
  const binary = engine === 'chromium' ? findBrowser() : findFirefox();
  console.log(`${engine}: ${binary}`);
  console.log(execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim());
  let browser, transport;
  try {
    browser = engine === 'chromium' ? await launch({ binary }) : await launchFirefox({ binary });
    transport = engine === 'chromium' ? await createCDP(browser.wsUrl) : await createBiDi(browser.wsUrl);
    console.log(`${engine}: protocol connection succeeded`);
  } finally {
    transport?.close();
    if (browser) await (engine === 'chromium' ? cleanupBrowser(browser) : cleanupFirefox(browser));
  }
}
