#!/usr/bin/env python3
"""Render the positions where the human-style solver gets stuck (JSON from tools/stuck_report.mjs) as PNG images.

    python3 tools/render_stuck.py tools/calibration/stuck

For every case it writes
    <name>_1_overview.png   the whole board at the point the rules run out (yellow = cells still undecided), with the detail window boxed
    <name>_2_detail.png     the area around the undecided cells, three panels:
                              POSITION  what the solver knows (blue segments, black boxes, dots) and what it cannot decide (yellow)
                              ANSWER    the same, plus the solution there: red outline = a box, green line = a segment still to be found
                              LOOKAHEAD the cheapest trial the solver can do: assume the ringed cell/segment, follow the easy rules
                                        (red = what they force) until something breaks; what that proves is written under the panel
and an index README.md. Needs Pillow (a virtualenv: python3 -m venv v && v/bin/pip install pillow).
"""
import json, math, os, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

FONTS = ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/SFNS.ttf', '/Library/Fonts/Arial.ttf']
def font(size):
    for f in FONTS:
        try: return ImageFont.truetype(f, size)
        except Exception: pass
    return ImageFont.load_default()

UNK, SHADED, LOOP, CLUE = 0, 1, 2, 3
DR = [-1, 0, 1, 0]; DC = [0, 1, 0, -1]
COL = lambda c: (chr(65 + c) if c < 26 else chr(64 + c // 26) + chr(65 + c % 26))
CELLNAME = lambda case, i: f"{COL(i % case['cols'])}{i // case['cols'] + 1}"
EDGE_CELLS = lambda case, x: (x >> 1, (x >> 1) + (case['cols'] if x & 1 else 1))

BLUE = (25, 118, 210); GREEN = (30, 150, 60); RED = (200, 40, 40); TINT = (255, 240, 170); GRID = (205, 205, 205)

def arrow(d, draw, cx, cy, S, fill=(20, 20, 20)):
    L = S * 0.17; head = S * 0.11
    dx, dy = DC[d], DR[d]
    x0, y0 = cx - dx * L, cy - dy * L; x1, y1 = cx + dx * L, cy + dy * L
    draw.line([(x0, y0), (x1, y1)], fill=fill, width=max(2, int(S * 0.06)))
    px, py = -dy, dx
    draw.polygon([(x1 + dx * head * 0.4, y1 + dy * head * 0.4), (x1 - dx * head + px * head, y1 - dy * head + py * head), (x1 - dx * head - px * head, y1 - dy * head - py * head)], fill=fill)

def draw_board(case, S, window, layers, chain=None, caption=''):
    r0, c0, r1, c1 = window
    nr, nc = r1 - r0 + 1, c1 - c0 + 1
    LBL, CAP = int(S * 0.5), int(S * 0.55) if caption else 0
    img = Image.new('RGB', (nc * S + LBL + 6, nr * S + LBL + CAP + 14), 'white')
    di = ImageDraw.Draw(img)
    board = Image.new('RGB', (nc * S + 1, nr * S + 1), 'white')   # everything is drawn here, so nothing spills over the labels
    d = ImageDraw.Draw(board)
    ox, oy = 0, 0
    cell, e = case['cell'], case['e']
    rows, cols = case['rows'], case['cols']
    pos = lambda r, c: (ox + (c - c0) * S, oy + (r - r0) * S)
    center = lambda r, c: (ox + (c - c0 + 0.5) * S, oy + (r - r0 + 0.5) * S)
    inwin = lambda r, c: r0 <= r <= r1 and c0 <= c <= c1
    clue_at = {(cl['r'], cl['c']): cl for cl in case['clues']}
    boxes = set(case['boxes'])
    f_lbl = font(max(9, int(S * 0.32))); f_n = font(int(S * 0.46))
    for c in range(c0, c1 + 1):
        x, _ = pos(r0, c); di.text((LBL + x + S / 2, LBL / 2), COL(c), fill=(90, 90, 90), font=f_lbl, anchor='mm')
    for r in range(r0, r1 + 1):
        _, y = pos(r, c0); di.text((LBL / 2 - 2, LBL + y + S / 2), str(r + 1), fill=(90, 90, 90), font=f_lbl, anchor='mm')
    # cells
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            i = r * cols + c; x, y = pos(r, c)
            if (r, c) in clue_at:
                cl = clue_at[(r, c)]
                d.rectangle([x, y, x + S, y + S], fill=(226, 229, 233))
                cx, cy = x + S / 2, y + S / 2
                if cl['d'] in (0, 2):
                    d.text((cx - S * 0.2, cy), str(cl['n']), fill=(20, 20, 20), font=f_n, anchor='mm'); arrow(cl['d'], d, cx + S * 0.2, cy, S)
                else:
                    d.text((cx, cy - S * 0.2), str(cl['n']), fill=(20, 20, 20), font=f_n, anchor='mm'); arrow(cl['d'], d, cx, cy + S * 0.22, S)
            elif cell[i] == UNK and 'tint' in layers:
                d.rectangle([x, y, x + S, y + S], fill=TINT)
    for k in range(nc + 1): d.line([(ox + k * S, oy), (ox + k * S, oy + nr * S)], fill=GRID, width=1)
    for k in range(nr + 1): d.line([(ox, oy + k * S), (ox + nc * S, oy + k * S)], fill=GRID, width=1)
    # known boxes and dots
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            i = r * cols + c; x, y = pos(r, c)
            if cell[i] == SHADED:
                d.rounded_rectangle([x + 3, y + 3, x + S - 3, y + S - 3], radius=max(2, S // 8), fill=(20, 20, 20))
                if i in boxes: d.rounded_rectangle([x + S * 0.28, y + S * 0.28, x + S * 0.72, y + S * 0.72], radius=2, outline=(230, 230, 230), width=2)
    seg_w = max(3, int(S * 0.13))
    def segment(a, b, color, width, dash=False):
        (ra, ca), (rb, cb) = divmod(a, cols), divmod(b, cols)
        if not (inwin(ra, ca) or inwin(rb, cb)): return
        (xa, ya), (xb, yb) = center(ra, ca), center(rb, cb)
        if dash:
            n = 6
            for k in range(0, n, 2): d.line([(xa + (xb - xa) * k / n, ya + (yb - ya) * k / n), (xa + (xb - xa) * (k + 1) / n, ya + (yb - ya) * (k + 1) / n)], fill=color, width=width)
        else: d.line([(xa, ya), (xb, yb)], fill=color, width=width)
    deg = {}
    for x in range(len(e)):
        if e[x] == 1:
            a, b = EDGE_CELLS(case, x); segment(a, b, BLUE, seg_w); deg[a] = deg.get(a, 0) + 1; deg[b] = deg.get(b, 0) + 1
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            i = r * cols + c
            if cell[i] == LOOP and deg.get(i, 0) == 0:
                cx, cy = center(r, c); d.ellipse([cx - S * 0.07, cy - S * 0.07, cx + S * 0.07, cy + S * 0.07], fill=(110, 120, 135))
    # the solution in the undecided area
    if 'answer' in layers:
        for x in range(len(e)):
            if e[x] == 0 and case['solE'][x] == 1:
                a, b = EDGE_CELLS(case, x); segment(a, b, GREEN, seg_w)
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                i = r * cols + c; x, y = pos(r, c)
                if cell[i] == UNK and case['solCell'][i] == SHADED:
                    d.rounded_rectangle([x + 4, y + 4, x + S - 4, y + S - 4], radius=max(2, S // 8), outline=RED, width=max(3, S // 12))
                    d.line([(x + S * 0.3, y + S * 0.3), (x + S * 0.7, y + S * 0.7)], fill=RED, width=2); d.line([(x + S * 0.7, y + S * 0.3), (x + S * 0.3, y + S * 0.7)], fill=RED, width=2)
    # the lookahead chain
    if chain is not None:
        for step in chain['chain']['steps']:
            for k, i, v in step['sets']:
                if k == 'c':
                    r, c = divmod(i, cols)
                    if not inwin(r, c): continue
                    x, y = pos(r, c)
                    if v == SHADED: d.rounded_rectangle([x + 5, y + 5, x + S - 5, y + S - 5], radius=max(2, S // 8), outline=RED, width=2, fill=(255, 215, 215))
                    else:
                        cx, cy = center(r, c); d.ellipse([cx - S * 0.1, cy - S * 0.1, cx + S * 0.1, cy + S * 0.1], outline=RED, width=2)
                else:
                    a, b = EDGE_CELLS(case, i)
                    if v == 1: segment(a, b, RED, max(2, seg_w - 1), dash=True)
                    else:
                        (ra, ca), (rb, cb) = divmod(a, cols), divmod(b, cols)
                        if inwin(ra, ca) or inwin(rb, cb):
                            (xa, ya), (xb, yb) = center(ra, ca), center(rb, cb); mx, my = (xa + xb) / 2, (ya + yb) / 2; q = S * 0.12
                            d.line([(mx - q, my - q), (mx + q, my + q)], fill=RED, width=2); d.line([(mx - q, my + q), (mx + q, my - q)], fill=RED, width=2)
        why = chain['chain'].get('why') or {}
        for i in why.get('cells', []):
            r, c = divmod(i, cols)
            if inwin(r, c):
                x, y = pos(r, c); d.rounded_rectangle([x + 2, y + 2, x + S - 2, y + S - 2], radius=max(2, S // 8), outline=(170, 0, 170), width=max(3, S // 10))
        for k, i, v in chain['assumption']:
            if k == 'c':
                r, c = divmod(i, cols)
                if inwin(r, c):
                    x, y = pos(r, c); d.rounded_rectangle([x + 1, y + 1, x + S - 1, y + S - 1], radius=max(2, S // 8), outline=RED, width=max(4, S // 8))
                    cx, cy = center(r, c)
                    if v == SHADED: d.rounded_rectangle([x + S * 0.3, y + S * 0.3, x + S * 0.7, y + S * 0.7], radius=2, fill=RED)
                    else: d.ellipse([cx - S * 0.1, cy - S * 0.1, cx + S * 0.1, cy + S * 0.1], fill=RED)
            else:
                a, b = EDGE_CELLS(case, i)
                (ra, ca), (rb, cb) = divmod(a, cols), divmod(b, cols); (xa, ya), (xb, yb) = center(ra, ca), center(rb, cb)
                if v == 1: segment(a, b, RED, seg_w + 2)
                else:
                    mx, my = (xa + xb) / 2, (ya + yb) / 2; q = S * 0.2
                    d.line([(mx - q, my - q), (mx + q, my + q)], fill=RED, width=4); d.line([(mx - q, my + q), (mx + q, my - q)], fill=RED, width=4)
    d.rectangle([ox, oy, ox + nc * S, oy + nr * S], outline=(30, 30, 30), width=2)
    img.paste(board, (LBL, LBL))
    if caption:
        di.text((LBL, LBL + nr * S + 12), caption, fill=(40, 40, 40), font=font(max(11, int(S * 0.36))))
    return img

def open_cells(case):
    """Cells the rules could not settle: undecided cells, and loop cells still missing a segment."""
    cols = case['cols']; cell, e = case['cell'], case['e']
    deg = {}
    for x in range(len(e)):
        if e[x] == 1:
            a, b = EDGE_CELLS(case, x); deg[a] = deg.get(a, 0) + 1; deg[b] = deg.get(b, 0) + 1
    return [i for i in range(case['rows'] * cols) if cell[i] == UNK or (cell[i] == LOOP and deg.get(i, 0) < 2) or (cell[i] == 0)]

def lookahead_text(case, la):
    info = la['info']; cols = case['cols']
    if la['rule'] == 'tryCell':
        what = f"Assume {CELLNAME(case, info['cell'])} is {info['assumed']}"
    else:
        a, b = EDGE_CELLS(case, info['edge']); what = f"Assume the segment {CELLNAME(case, a)}-{CELLNAME(case, b)} is {info['assumed']}"
    rules = []
    for s in la['chain']['steps']:
        if not rules or rules[-1] != s['rule']: rules.append(s['rule'])
    concl = []
    for k, i, v in la['concludes']:
        if k == 'c': concl.append(f"{CELLNAME(case, i)} is {'a box' if v == SHADED else 'on the loop'}")
        else:
            a, b = EDGE_CELLS(case, i); concl.append(f"segment {CELLNAME(case, a)}-{CELLNAME(case, b)} is {'drawn' if v == 1 else 'ruled out'}")
    return what, rules, concl

def render_case(case, out):
    rows, cols = case['rows'], case['cols']
    opn = open_cells(case)
    if case['lookahead']:  # the window must also show where the trial breaks and what it assumes
        la0 = case['lookahead'][0]
        opn = opn + (la0['chain'].get('why') or {}).get('cells', []) + [i for k, i, v in la0['assumption'] if k == 'c'] + [EDGE_CELLS(case, i)[0] for k, i, v in la0['assumption'] if k == 'e']
    rs = [i // cols for i in opn] or [0]; cs = [i % cols for i in opn] or [0]
    M = 3
    r0, r1, c0, c1 = max(0, min(rs) - M), min(rows - 1, max(rs) + M), max(0, min(cs) - M), min(cols - 1, max(cs) + M)
    if (r1 - r0 + 1) > 26 or (c1 - c0 + 1) > 26: r0, r1, c0, c1 = 0, rows - 1, 0, cols - 1
    # 1. overview
    S = 26 if rows * cols > 300 else 34
    ov = draw_board(case, S, (0, 0, rows - 1, cols - 1), {'tint'})
    d = ImageDraw.Draw(ov); LBL = int(S * 0.5)
    d.rectangle([LBL + c0 * S, LBL + r0 * S, LBL + (c1 + 1) * S, LBL + (r1 + 1) * S], outline=RED, width=3)
    ov.save(os.path.join(out, f"{case['name']}_1_overview.png"))
    # 2. detail: position | answer | lookahead
    S = 52 if (r1 - r0 + 1) * (c1 - c0 + 1) <= 300 else 40
    w = (r0, c0, r1, c1)
    la = case['lookahead'][0] if case['lookahead'] else None
    what, rules, concl = lookahead_text(case, la) if la else ('', [], [])
    panels = [draw_board(case, S, w, {'tint'}, caption=f"POSITION ({len(case['undecided'])} open, yellow)"),
              draw_board(case, S, w, {'tint', 'answer'}, caption='ANSWER (red = box, green = segment)')]
    if la: panels.append(draw_board(case, S, w, {'tint'}, chain=la, caption='LOOKAHEAD (red = the trial)'))
    W = max(1180, sum(p.width for p in panels) + 20 * (len(panels) - 1)); H = max(p.height for p in panels)
    title = f"{case['name']}   {cols}x{rows}   source: {case['source']}" + (f"   (derived from {case['derivedFrom']}, {case['cluesRemoved']} clue(s) removed)" if case.get('derivedFrom') else '')
    rounds = case['stepsBeforeStuck'] if isinstance(case['stepsBeforeStuck'], int) else len(case['stepsBeforeStuck'])
    lines = [(26, (10, 10, 10), textwrap.wrap(title, W // 14)), (17, (70, 70, 70), [f"the rules (everything except trial and error) made {rounds} rounds and then had nothing left"])]
    if la:
        proved = '; '.join(concl) if concl else '?'
        why = (la['chain'].get('why') or {}).get('text', 'a contradiction')
        lines.append((17, (150, 30, 30), textwrap.wrap(f"TRIAL: {what}. Follow the easy rules ({' > '.join(rules[:8])}{' ...' if len(rules) > 8 else ''}). It BREAKS: {why} (purple). So: {proved}.", W // 9)))
    head = 12 + sum(len(ls) * (sz + 6) for sz, _, ls in lines) + 8
    img = Image.new('RGB', (W, H + head), 'white'); dd = ImageDraw.Draw(img)
    y = 10
    for sz, color, ls in lines:
        for l in ls: dd.text((8, y), l, fill=color, font=font(sz)); y += sz + 6
    x = 0
    for p in panels: img.paste(p, (x, head)); x += p.width + 20
    img.save(os.path.join(out, f"{case['name']}_2_detail.png"))
    return (r0, c0, r1, c1), what, rules, concl

def main(root):
    jd = os.path.join(root, 'json'); out = os.path.join(root, 'images'); os.makedirs(out, exist_ok=True)
    cases = [json.load(open(os.path.join(jd, f))) for f in sorted(os.listdir(jd)) if f.endswith('.json')]
    cases.sort(key=lambda c: (c['source'] == 'derived', c['name']))
    lines = ['# Where the solver gets stuck', '', 'Each case is a position the rules (everything except trial and error) cannot finish. `overview` shows the whole board;',
             '`detail` shows the area around the open cells as POSITION | ANSWER | LOOKAHEAD (the cheapest trial that does make progress).', '',
             '| case | size | source | open cells | the trial that works | chain of easy rules | where it breaks | what it proves |', '| --- | --- | --- | --- | --- | --- | --- | --- |']
    for c in cases:
        win, what, rules, concl = render_case(c, out)
        src = c['source'] + (f" ({c['derivedFrom']}, -{c['cluesRemoved']} clue)" if c.get('derivedFrom') else '')
        lines.append(f"| [{c['name']}](images/{c['name']}_2_detail.png) ([overview](images/{c['name']}_1_overview.png)) | {c['cols']}x{c['rows']} | {src} | {len(c['undecided'])} | {what or '-'} | {' > '.join(rules[:6]) or '-'} | {(c['lookahead'][0]['chain'].get('why') or {}).get('text', '-') if c['lookahead'] else '-'} | {'; '.join(concl) or '-'} |")
        print('rendered', c['name'])
    open(os.path.join(root, 'README.md'), 'w').write('\n'.join(lines) + '\n')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'tools/calibration/stuck')
