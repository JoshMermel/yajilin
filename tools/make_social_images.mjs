// Makes the two pictures index.html points at for link previews and the iOS Home Screen:
//   og-image.png          1200x630, a solved puzzle next to the name (the page is tools/social_card.html)
//   apple-touch-icon.png  180x180, the favicon without its rounded corners (iOS rounds them itself)
//
//   node tools/make_social_images.mjs [book puzzle]        e.g. 8x8 1 (the default)
//
// Needs a Chrome or Chromium to take the pictures: set CHROME to its executable, or have Google Chrome installed (or a Playwright
// Chromium in ~/Library/Caches/ms-playwright). Serves the repo on a free local port while it works.
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir, homedir } from 'node:os';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [book = '8x8', puzzle = '1'] = process.argv.slice(2);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const found = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
  if (found) return found;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
      const app = join(cache, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      if (existsSync(app)) return app;
    }
  }
  throw new Error('No Chrome found: set CHROME to a Chrome or Chromium executable.');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer((req, res) => {
  const file = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = findChrome();
const work = mkdtempSync(join(tmpdir(), 'yj-social-'));

// async: the page is served by this very process, so it must stay free to answer while Chrome loads it
const run = promisify(execFile);
async function shot(url, out, w, h, scale = 1) {
  await run(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${work}`, `--window-size=${w},${h}`, `--force-device-scale-factor=${scale}`,
    '--virtual-time-budget=4000', `--screenshot=${out}`, url]);
}

try {
  await shot(`${base}/tools/social_card.html?book=${book}&puzzle=${puzzle}`, join(ROOT, 'og-image.png'), 1200, 630);
  // the favicon's own drawing, edge to edge: drop the rounded corners (and the title, which would show as text in a stray tooltip)
  const svg = readFileSync(join(ROOT, 'favicon.svg'), 'utf8').replace(/ rx="7"/, '').replace(/<title>.*?<\/title>/, '');
  const page = join(work, 'icon.html');
  writeFileSync(page, `<!DOCTYPE html><style>html,body{margin:0;overflow:hidden}svg{display:block;width:180px;height:180px}</style>${svg}`);
  await shot(`file://${page}`, join(ROOT, 'apple-touch-icon.png'), 180, 180);
  console.log('wrote og-image.png and apple-touch-icon.png');
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}
