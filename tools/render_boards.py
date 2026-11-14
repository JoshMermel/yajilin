#!/usr/bin/env python3
"""Plain pictures of the boards where the human-style solver is stuck: just the board as the player would see it (clues, the
boxes, dots and segments the rules found), with nothing marked about what is undecided or what the answer is.

    /path/to/venv/bin/python tools/render_boards.py tools/calibration/stuck

Reads <root>/json (from tools/stuck_report.mjs) and writes <root>/boards/*.png plus boards/README.md. Positions that are the same
puzzle with the same open cells are written once.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_stuck import draw_board

def main(root):
    jd = os.path.join(root, 'json'); out = os.path.join(root, 'boards')
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith('.png') or f == 'README.md': os.remove(os.path.join(out, f))
    cases = [json.load(open(os.path.join(jd, f))) for f in sorted(os.listdir(jd)) if f.endswith('.json')]
    cases.sort(key=lambda c: (c['source'] == 'derived', len(c['undecided']), c['name']))
    seen, kept = set(), []
    for c in cases:
        key = (c.get('derivedFrom') or c['name'], tuple(sorted(c['undecided'])))
        if key in seen: continue
        seen.add(key); kept.append(c)
    lines = ['# Boards where the solver is stuck', '',
             'Plain pictures: clues, plus the boxes (black), dots and segments (blue) the rules have found so far. Everything the rules cannot',
             'decide is left empty. The same position is shown once. `case` is the name in `../json` and `../images` (the annotated versions).', '',
             '| picture | size | case | cells left undecided |', '| --- | --- | --- | --- |']
    for k, c in enumerate(kept, 1):
        rows, cols = c['rows'], c['cols']
        S = 46 if max(rows, cols) <= 14 else 40 if max(rows, cols) <= 20 else 32
        img = draw_board(c, S, (0, 0, rows - 1, cols - 1), set())
        name = f"{k:02d}_{cols}x{rows}.png"
        img.save(os.path.join(out, name))
        lines.append(f"| [{name}]({name}) | {cols}x{rows} | {c['name']} | {len(c['undecided'])} |")
    open(os.path.join(out, 'README.md'), 'w').write('\n'.join(lines) + '\n')
    print(f'wrote {len(kept)} boards (of {len(cases)} cases) to {out}')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'tools/calibration/stuck')
