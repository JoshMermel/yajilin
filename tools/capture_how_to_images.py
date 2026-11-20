"""
capture_how_to_images.py

Screenshots for docs/how_to_solve.md: for every example in docs/examples/examples.json, open the live app on the armory book, put the
board in the example's position (the marks a player has after pressing Hint and marking what it says, hint by hint), press Hint, and save
the board together with the hint's panel to docs/images/<rule>.png.

Needs Playwright (pip install playwright; playwright install chromium) and the repo served over HTTP (npm run serve, port 8766).

    python3 tools/capture_how_to_images.py [base_url] [rule ...]

With rule names, only those images are redone.
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent

# the app's own look, light theme, the hint panel moved from the bottom of the window to just under the board, and the timing
# in the hint's first line dropped (it would change on every capture)
PANEL_CSS = """
#toast.hint { position: static !important; transform: none !important; margin: 10px auto 0 !important; cursor: default; }
"""


def capture(page, base, ex, out_path):
    page.goto(f"{base}/index.html?book=armory&puzzle={ex['puzzle']}")
    page.wait_for_load_state("networkidle")
    # the save for this puzzle, in the app's own format (cells, segments, automatic dots), under the key the app computes
    key = page.evaluate(
        """async (n) => {
            const { parseCsv, compile, puzzleHash } = await import('./js/logic.js');
            const text = await (await fetch('data/armory.csv')).text();
            return 'yj_save_' + puzzleHash(compile(parseCsv(text)[n - 1]));
        }""",
        ex["puzzle"],
    )
    save = {"c": ex["cells"], "e": ex["edges"], "a": "0" * len(ex["cells"])}
    page.evaluate(
        """([key, save]) => {
            localStorage.setItem(key, JSON.stringify(save));
            localStorage.setItem('yj_dark', '0');
            localStorage.setItem('yj_autoRotate', '0');
            localStorage.setItem('yj_autoDots', '0');
            localStorage.setItem('yj_seenHelp', '1');
            localStorage.setItem('yj_labels', '1');
        }""",
        [key, save],
    )
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(200)
    page.click("#hint-btn")
    page.wait_for_timeout(200)
    shown = page.evaluate(
        """() => {
            const m = document.querySelector('#toast .hint-meta');
            if (m) m.textContent = m.textContent.replace(/ · \\d+ ms$/, '');
            return m ? m.textContent : null;
        }"""
    )
    box = page.evaluate(
        """() => {
            const b = document.getElementById('board').getBoundingClientRect(), t = document.getElementById('toast').getBoundingClientRect();
            return { x: Math.min(b.left, t.left) - 8, y: b.top - 8, w: Math.max(b.right, t.right) - Math.min(b.left, t.left) + 16, h: t.bottom - b.top + 16 };
        }"""
    )
    page.screenshot(path=str(out_path), clip={"x": max(box["x"], 0), "y": max(box["y"], 0), "width": box["w"], "height": box["h"]})
    return shown


def main():
    args = sys.argv[1:]
    base = args[0] if args and args[0].startswith("http") else "http://localhost:8766"
    only = [a for a in args if not a.startswith("http")]
    examples = json.loads((ROOT / "docs/examples/examples.json").read_text())
    out_dir = ROOT / "docs/images"
    out_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 640, "height": 1300}, device_scale_factor=2)
        page.add_init_script(
            "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = "
            + json.dumps(PANEL_CSS)
            + "; document.head.appendChild(s); });"
        )
        for ex in examples:
            if only and ex["rule"] not in only:
                continue
            page.goto(base + "/index.html")
            shown = capture(page, base, ex, out_dir / f"{ex['rule']}.png")
            flag = "" if shown and shown.startswith(ex["rule"]) else "   <-- the hint shows something else"
            print(f"{ex['rule']}: {shown}{flag}", flush=True)
        browser.close()


if __name__ == "__main__":
    main()
