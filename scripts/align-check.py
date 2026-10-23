#!/usr/bin/env python3
"""Alignment: every icon, tile, dot and badge on the landlord's and the tenants' pages sits centered on the text it
goes with, at 1280 and 390 px, on a production build with every model and PayPal stubbed.

What centered means here is measured, not guessed from the classes. Text is placed where Chrome draws it (each line's
box from the page, its baseline from the font's own ascent and descent, its cap height from the font), and a mark is
compared with the middle of the capitals:

  - A mark no taller than the line beside it (a 16 px icon on a 20 px line, a status dot) is centered on that line's
    capitals, or, beside several lines, on the block (a trailing chevron centered on a title and its subtitle).
  - A mark taller than the line (a 32 px tile) is centered on the whole block of text beside it. Only when that block
    runs at least half a line past the tile may the tile instead center on the first line (a long paragraph). A block's
    middle is that of its ink (the first line's capitals to the last line's baseline) or of its lines' boxes: under a
    big title on a small line the two differ by up to 1.5 px from the font's own spacing, which no layout changes. An
    icon button with no box the eye sees (a drawer's close X) counts as its icon's size.
  - A glyph in its own frame (a tile, an icon button, a round avatar) is centered in it on both axes, and so is a
    numbered tile's or an avatar's text; a one-line button, chip or badge with a box the eye sees (a fill unlike the
    one behind it, a border all round or a shadow; a rule on one side is a divider) has its label centered top to
    bottom.
  - A mark on a line of running text (an info tip after a label) is centered on that line's capitals; a mark stacked
    over centered text (an empty state) is centered over it side to side.

The tolerance is 0.75 px: Chrome rounds Inter's ascent and descent to whole pixels, so a line box centered on a mark
puts the capitals within 0.6 px of its middle at every size the app uses, and anything a visitor can see is a pixel or
more. Charts, marks positioned over something (absolute or fixed), hidden ones, anything over 48 px and photos (an
image over 32 px: a card's picture sits level with the top of its text) are left out, and so is anything inside
[data-align=skip] (none at the time of writing).

The run, the checklist's (as scripts/e2e-demo.py, whose build, server and copy it reuses): a temporary worktree of HEAD
with this checkout's uncommitted changes laid over it, next build, next start on 3211 (or --port) with the stubs on, a
fresh test copy of the demo (never the judges' code), the pages and their opened states (the header's menus, Start
over, the welcome card and each stop of its tour, the phone navigation, an info tip, a row's More, the Add finding
drawer, the statements and notices as printed, the tenants' dispute and their advocate's case), then the copy, the
server and the worktree removed:

  /path/to/python scripts/align-check.py --worktree /tmp/gf-align-wt --shots /tmp/gf-align-shots
  python scripts/align-check.py --serve /tmp/gf-e2e-wt --shots /tmp/gf-align-shots
  python scripts/align-check.py --base http://localhost:3211 --codes /tmp/gf-e2e-hold/codes.json
  python scripts/align-check.py --self-test     # the measure on a fixed page of right and wrong rows, no server

Before the site it runs the measure on that fixed page, so a measure that stopped seeing misses fails too. Each miss is
printed once per kind of row (the same component in every place it shows), with dy (the mark's middle below the text's,
in px) and dx, where it shows, and a cropped screenshot of its first place in --shots/misses. Exits 1 on any miss or
failed check, 2 if it couldn't run. Needs Playwright for Python with Chromium, and Node.
"""
import argparse
import importlib.util
import json
import os
import re
import signal
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("e2e_demo", REPO / "scripts/e2e-demo.py")
e2e = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(e2e)

WIDTHS = {"1280": {"width": 1280, "height": 900}, "390": {"width": 390, "height": 844}}
TOL = 0.75

failed = 0
passed = 0
misses = []  # every miss, with the view it was seen on
views = 0
counted = {"pairs": 0, "frames": 0, "labels": 0}


def check(name, ok, detail=""):
    global failed, passed
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"{'PASS' if ok else 'FAIL'} {name}{'' if ok else f': {detail}'}", flush=True)
    return ok


# ---------- In the page ----------

# Measures every mark under `root` (the page, or an open dialog or menu) and returns the misses and how much was
# measured. Each miss keeps its elements in window.__align.els, so the run can crop a screenshot of it.
MEASURE = r"""
async ([rootSel, TOL]) => {
  await document.fonts.ready;
  const root = rootSel ? document.querySelector(rootSel) : document.body;
  if (!root) return { error: `nothing matches ${rootSel}` };
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  cv.width = cv.height = 1;
  const alpha = (c) => {
    if (!c || c === 'transparent' || c === 'none') return 0;
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    return cx.getImageData(0, 0, 1, 1).data[3] / 255;
  };
  const metrics = new Map();
  const fontOf = (el) => {
    const s = getComputedStyle(el);
    const key = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    if (!metrics.has(key)) {
      cx.font = key;
      const m = cx.measureText('H');
      metrics.set(key, { cap: m.actualBoundingBoxAscent, asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent });
    }
    return { ...metrics.get(key), size: parseFloat(s.fontSize), lh: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2 };
  };
  const shown = (el) => el.checkVisibility({ checkVisibilityCSS: true, opacityProperty: true });
  const skip = (el) => !!el.closest('[data-align=skip], .ag-charts-wrapper');
  const placed = (el) => /^(absolute|fixed)$/.test(getComputedStyle(el).position);

  // The text under `box`, outside `out`, as fragments of lines: where Chrome put each line of each text node, its
  // baseline (the line's box split in the font's ascent to descent) and the middle and top of its capitals.
  const frags = (box, out = []) => {
    const res = [];
    const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      if (!t.textContent.trim()) continue;
      const el = t.parentElement;
      if (!el || el.closest('svg') || out.some((x) => x.contains(el)) || !shown(el)) continue;
      const er = el.getBoundingClientRect();
      if (er.width <= 1.5 || er.height <= 1.5) continue;  // visually hidden (sr-only)
      const f = fontOf(el);
      const rg = document.createRange(); rg.selectNodeContents(t);
      for (const r of rg.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        const base = r.top + r.height * f.asc / (f.asc + f.desc);
        const lineTop = base - f.asc - (f.lh - f.asc - f.desc) / 2;
        res.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, base, capTop: base - f.cap, capC: base - f.cap / 2,
          lineTop, lineBottom: lineTop + f.lh, lh: f.lh, size: f.size, el, text: t.textContent.trim() });
      }
    }
    return res;
  };
  // Fragments on the same line merged; each line keeps its biggest text as the one its capitals are read from.
  const lines = (fs) => {
    const out = [];
    for (const f of [...fs].sort((a, b) => a.top - b.top)) {
      const l = out.find((l) => Math.min(l.bottom, f.bottom) - Math.max(l.top, f.top) > 0.5 * Math.min(l.bottom - l.top, f.bottom - f.top));
      if (l) {
        l.top = Math.min(l.top, f.top); l.bottom = Math.max(l.bottom, f.bottom); l.left = Math.min(l.left, f.left); l.right = Math.max(l.right, f.right);
        if (f.size > l.ref.size) l.ref = f;
      } else out.push({ top: f.top, bottom: f.bottom, left: f.left, right: f.right, ref: f });
    }
    return out.sort((a, b) => a.ref.base - b.ref.base);
  };
  // A box the eye sees: a fill unlike the one behind it, a border all round or a shadow (a rule on one side is a
  // divider, not a box; a grid's white row on its white card is no box either).
  const behind = (el) => {
    for (let a = el.parentElement; a; a = a.parentElement) { const c = getComputedStyle(a).backgroundColor; if (alpha(c) > 0.03) return c; }
    return 'rgb(255, 255, 255)';
  };
  const seen_ = (el) => {
    const s = getComputedStyle(el);
    if ((alpha(s.backgroundColor) > 0.03 && s.backgroundColor !== behind(el)) || s.backgroundImage !== 'none' || s.boxShadow !== 'none') return true;
    return ['Top', 'Right', 'Bottom', 'Left'].every((k) => parseFloat(s[`border${k}Width`]) > 0 && alpha(s[`border${k}Color`]) > 0.03);
  };
  // A frame: a box the eye sees, or a control (an icon button's middle is where its hover fill and focus ring go).
  const boxy = (el) => seen_(el) || el.matches('button, a[href], [role=button], [role=tab], [role=menuitem], summary');
  // The inside of a frame (inside its borders): what the eye takes as its middle.
  const inner = (el) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    const t = parseFloat(s.borderTopWidth) || 0, b = parseFloat(s.borderBottomWidth) || 0, l = parseFloat(s.borderLeftWidth) || 0, rr = parseFloat(s.borderRightWidth) || 0;
    return { top: r.top + t, bottom: r.bottom - b, left: r.left + l, right: r.right - rr, width: r.width - l - rr, height: r.height - t - b };
  };
  const cls = (el) => {
    if (!el) return '';
    const c = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 10).join('.');
    const name = el.getAttribute('aria-label');
    return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${name ? `[aria-label="${name.slice(0, 30)}"]` : ''}`;
  };
  const r2 = (x) => Math.round(x * 100) / 100;
  window.__align = window.__align || { els: [] };
  const out = [], seen = new Set(), stats = { pairs: 0, frames: 0, labels: 0, marks: 0 };
  const where = (el) => el.closest('[data-name]')?.getAttribute('data-name') || null;
  const miss = (kind, dy, dx, mark, frame, row, fs, sig) => {
    const id = window.__align.els.push([frame || mark, ...new Set(fs.map((f) => f.el))]) - 1;
    out.push({ kind, dy: r2(dy), dx: r2(dx), mark: cls(mark), frame: frame ? cls(frame) : null, row: cls(row), text: (fs[0]?.text || '').slice(0, 60),
      sig: `${kind} | ${sig}`, id, name: where(mark) });
  };

  // The marks: icons and logos (svg, small images), checkboxes and radios, dots (an empty round fill, 3 to 12 px),
  // and numbered tiles and avatars (a square or round fill, 12 to 32 px, holding one to three characters).
  const marks = [];
  for (const el of root.querySelectorAll('svg, img, input[type=checkbox], input[type=radio]')) {
    if (el.parentElement.closest('svg') || skip(el) || !shown(el)) continue;
    const r = el.getBoundingClientRect();
    // A photo (an image over 32 px) is a picture beside a card's text, its top level with the text's: not a mark.
    if (r.width < 4 || r.height < 4 || r.width > 48 || r.height > 48 || (el.tagName === 'IMG' && Math.max(r.width, r.height) > 32)) continue;
    marks.push(el);
  }
  for (const el of root.querySelectorAll('span, div')) {
    const t = el.textContent.trim();
    if (!t || t.length > 3 || el.querySelector('svg, img') || skip(el) || !shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.width > 32 || Math.abs(r.width - r.height) > 2 || !boxy(el)) continue;
    marks.push(el);
  }
  for (const el of root.querySelectorAll('span, div, i')) {
    if (el.childElementCount || el.textContent.trim() || skip(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.width > 12 || Math.abs(r.width - r.height) > 0.5 || !shown(el)) continue;
    const s = getComputedStyle(el);
    if (alpha(s.backgroundColor) < 0.1 || parseFloat(s.borderTopLeftRadius) < r.width / 2 - 0.5) continue;
    marks.push(el);
  }

  for (const m of marks) {
    stats.marks++;
    // Its frame: the box around just it, with no text of its own (a tile, an icon button), within three levels. A dot,
    // a checkbox or a numbered tile has none (a switch's knob sits to one side of its track on purpose).
    let V = m, n = /^(svg|img)$/i.test(m.tagName) ? m.parentElement : null;
    for (let i = 0; i < 3 && n && n !== root.parentElement; i++, n = n.parentElement) {
      if (frags(n).length) break;
      const r = n.getBoundingClientRect();
      if (r.width > 64 || r.height > 64) break;
      if (boxy(n)) { V = n; break; }
    }
    if (V !== m && !seen.has(V)) {
      seen.add(V);
      const others = [...V.querySelectorAll('svg, img, span, div, i')].filter((x) => x !== m && !x.contains(m) && !m.contains(x) && shown(x) && !placed(x)
        && x.getBoundingClientRect().width >= 3 && x.getBoundingClientRect().height >= 3 && !(x.parentElement && x.parentElement.closest('svg')));
      let up = false;
      for (let c = m; c && c !== V; c = c.parentElement) if (placed(c)) up = true;
      if (!others.length && !up) {
        stats.frames++;
        const g = m.getBoundingClientRect(), b = inner(V);
        const dx = (g.left + g.right) / 2 - (b.left + b.right) / 2, dy = (g.top + g.bottom) / 2 - (b.top + b.bottom) / 2;
        if (Math.abs(dx) > TOL || Math.abs(dy) > TOL) miss('glyph off-center in its frame', dy, dx, m, V, V, [], `${cls(m)} in ${cls(V)}`);
      }
    }
    // What it goes with: the nearest box above it holding text, within four levels.
    let A = V.parentElement, fs = [];
    for (let i = 0; i < 4 && A && A !== document.body; i++, A = A.parentElement) {
      fs = frags(A, [V]);
      if (fs.length) break;
    }
    if (!fs.length) continue;
    let positioned = false;
    for (let c = V; c && c !== A; c = c.parentElement) if (placed(c)) positioned = true;
    if (positioned) continue;
    const v = V.getBoundingClientRect(), vc = (v.top + v.bottom) / 2, vx = (v.left + v.right) / 2;
    const branch = (el) => { if (el === A) return A; let c = el; while (c.parentElement && c.parentElement !== A) c = c.parentElement; return c; };
    const sig = `${cls(V)} in ${cls(A)}`;
    const inline = /^inline/.test(getComputedStyle(branch(V)).display) && !/(flex|grid)$/.test(getComputedStyle(A).display);
    if (inline) {
      // On a line of running text: the line it sits on.
      const on = lines(fs.filter((f) => f.top <= vc && f.bottom >= vc));
      if (!on.length) continue;
      stats.pairs++;
      const dy = vc - on[0].ref.capC;
      if (Math.abs(dy) > TOL) miss('mark off the middle of its line', dy, 0, m, V !== m ? V : null, A, [on[0].ref], sig);
      continue;
    }
    const beside = fs.filter((f) => f.left >= v.right - 1 || f.right <= v.left + 1);
    if (beside.length) {
      // The text block beside it: the nearest of the row's other children, and the lines of it that are beside.
      const groups = new Map();
      for (const f of beside) { const b = branch(f.el); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(f); }
      const gap = (g) => Math.min(...g.map((f) => (f.left >= v.right - 1 ? f.left - v.right : v.left - f.right) * 1000 + Math.abs(f.capC - vc)));
      const block = [...groups.values()].sort((a, b) => gap(a) - gap(b))[0];
      const L = lines(block), first = L[0], last = L[L.length - 1];
      stats.pairs++;
      // The middle of a block: of its ink (the first line's capitals to the last line's baseline), or of its lines'
      // boxes (what align-items: center centers). The two differ by up to a pixel and a half when a big title sits on
      // a small line, from the font's own spacing, which no layout can change; either is centered.
      const c1 = first.ref.capC, cb = (first.ref.capTop + last.ref.base) / 2, cbox = (first.ref.lineTop + last.ref.lineBottom) / 2;
      const nearest = (...ds) => ds.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
      // Its size as the eye takes it: the frame when the frame is seen (a tile), else the glyph (an icon button's box
      // shows only on hover, so its X is a 16 px icon beside the title).
      const size = V !== m && !seen_(V) ? m.getBoundingClientRect().height : v.height;
      const tall = size > first.ref.lh + 2;
      let dy, ok, kind;
      if (L.length === 1) {
        dy = vc - c1; ok = Math.abs(dy) <= TOL; kind = tall ? 'tile off the middle of its line' : 'mark off the middle of its line';
      } else if (!tall) {
        dy = nearest(vc - c1, vc - cb, vc - cbox); ok = Math.abs(dy) <= TOL; kind = 'mark off its first line and its block';
      } else {
        const long = last.bottom - first.top >= size + first.ref.lh / 2;
        dy = long ? nearest(vc - cb, vc - cbox, vc - c1) : nearest(vc - cb, vc - cbox); ok = Math.abs(dy) <= TOL;
        kind = long ? 'tile off its block and its first line' : 'tile off the middle of its block';
      }
      if (!ok) miss(kind, dy, 0, m, V !== m ? V : null, A, block, sig);
      continue;
    }
    // Stacked over centered text (an empty state): side to side over the first line below it.
    const below = lines(fs.filter((f) => f.top >= v.bottom - 1));
    if (below.length) {
      const el = below[0].ref.el, s = getComputedStyle(el), as = getComputedStyle(A);
      const centered = s.textAlign === 'center' || (/flex/.test(as.display) && as.flexDirection === 'column' && as.alignItems === 'center');
      if (!centered) continue;
      stats.pairs++;
      const dx = vx - (below[0].left + below[0].right) / 2;
      if (Math.abs(dx) > TOL) miss('mark off the middle of the text under it', 0, dx, m, V !== m ? V : null, A, [below[0].ref], sig);
    }
  }

  // Labels: a one-line button, chip, badge or avatar has its text centered top to bottom (and an avatar's or a
  // small round badge's initials side to side too).
  for (const el of root.querySelectorAll('button, a[href], [role=button], [role=tab], [role=menuitem], summary, span, div')) {
    if (skip(el) || !shown(el) || !seen_(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 48 || r.height < 12 || r.width < 12) continue;
    const own = frags(el).filter((f) => { for (let c = f.el; c && c !== el; c = c.parentElement) if (c !== el && boxy(c)) return false; return true; });
    if (!own.length) continue;
    const L = lines(own);
    if (L.length !== 1) continue;
    const b = inner(el);
    // Only boxes that hold their line with room to spare: a tall row cell is not a label.
    if (b.height > 2.6 * L[0].ref.lh) continue;
    stats.labels++;
    const dy = L[0].ref.capC - (b.top + b.bottom) / 2;
    const tile = own.map((f) => f.text).join('').length <= 3 && r.width <= 32 && Math.abs(r.width - r.height) <= 2;
    const dx = tile ? (L[0].left + L[0].right) / 2 - (b.left + b.right) / 2 : 0;
    if (Math.abs(dy) > TOL || Math.abs(dx) > TOL) miss(tile ? 'number or initials off-center in their tile' : 'label off the middle of its box', dy, dx, el, null, el, [L[0].ref], cls(el));
  }
  return { misses: out, stats };
}
"""

# The union of a miss's elements, padded, in the viewport after it is scrolled into view: what its crop shows.
CROP = r"""
(i) => {
  const els = window.__align.els[i].filter((e) => e.isConnected);
  if (!els.length) return null;
  els[0].scrollIntoView({ block: 'center', inline: 'nearest' });
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const e of els) { const x = e.getBoundingClientRect(); l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom); }
  const pad = 14;
  l = Math.max(0, l - pad); t = Math.max(0, t - pad); r = Math.min(innerWidth, r + pad); b = Math.min(innerHeight, b + pad);
  return r - l >= 4 && b - t >= 4 ? { x: l, y: t, width: Math.min(r - l, 900), height: Math.min(b - t, 400) } : null;
}
"""

# The measure's own test: rows that are right and rows that are wrong, in the patterns the app uses, each named and
# marked with what the measure must say. The first is the welcome card as it was (a 32 px tile, items-start, the
# text pushed down 6 px so a one-line row looks centered and a wrapped one doesn't).
FIXTURE = """<!doctype html><html><head><style>
body { font: 14px/20px Inter, system-ui, sans-serif; margin: 20px; width: 360px; }
.row { display: flex; gap: 12px; margin: 12px 0; } .start { align-items: flex-start; } .center { align-items: center; }
.tile { display: flex; width: 32px; height: 32px; flex-shrink: 0; align-items: center; justify-content: center; background: #eef0ff; border-radius: 6px; }
svg { display: block; flex-shrink: 0; width: 16px; height: 16px; } .tile svg { width: 15px; height: 15px; }
.ghost { display: inline-flex; width: 34px; height: 34px; flex-shrink: 0; align-items: center; justify-content: center; padding: 0; border: 0; background: none; }
.lh { display: flex; height: 20px; align-items: center; } .btn { display: inline-flex; height: 32px; align-items: center; gap: 6px; padding: 0 12px; border: 1px solid #ccc; border-radius: 6px; }
</style></head><body>
<div class="row start" data-name="tile-pushed-wrapped" data-expect="miss"><span class="tile"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></span><span style="padding-top:6px">Photos at move-in and move-out, room by room, so every charge has its proof</span></div>
<div class="row start" data-name="tile-pushed-one-line" data-expect="pass"><span class="tile"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></span><span style="padding-top:6px">One line</span></div>
<div class="row center" data-name="tile-centered-wrapped" data-expect="pass"><span class="tile"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></span><span>Photos at move-in and move-out, room by room, so every charge has its proof</span></div>
<div class="row start" data-name="tile-top-one-line" data-expect="miss"><span class="tile"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></span><span>One line</span></div>
<div class="row start" data-name="icon-top" data-expect="miss"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg><span>An icon at the top of its line</span></div>
<div class="row start" data-name="icon-in-one-line-box" data-expect="pass"><span class="lh"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></span><span>An icon in a box one line tall, then a second line of text below it</span></div>
<div class="row center" data-name="glyph-pushed-in-tile" data-expect="miss"><span class="tile" style="padding-top:4px; box-sizing:border-box"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></span><span>The glyph is low in its tile</span></div>
<p data-name="inline-on-baseline" data-expect="miss">Text with an icon <svg viewBox="0 0 16 16" style="display:inline-block"><circle cx="8" cy="8" r="6"/></svg> on its baseline</p>
<div data-name="button-centered" data-expect="pass"><span class="btn"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>Download</span></div>
<div data-name="button-label-low" data-expect="miss"><span class="btn" style="padding-top:5px; box-sizing:border-box">Label low</span></div>
<div class="row start" data-name="number-tile-nudged" data-expect="miss"><span class="tile" style="width:24px;height:24px;margin-top:1px;font-size:12px;line-height:16px">2</span><span>A numbered step, its tile pushed down a pixel</span></div>
<div class="row center" data-name="number-tile-centered" data-expect="pass"><span class="tile" style="width:24px;height:24px;font-size:12px;line-height:16px">3</span><span>A numbered step, centered</span></div>
<label class="row start" data-name="checkbox-nudged" data-expect="miss"><input type="checkbox" style="margin:3px 0 0;width:18px;height:18px;flex-shrink:0">I agree to the terms</label>
<label class="row start" data-name="checkbox-in-one-line-box" data-expect="pass"><span class="lh"><input type="checkbox" style="margin:0;width:18px;height:18px"></span>I agree to the terms</label>
<div class="row center" data-name="button-beside-title-and-address" data-expect="pass"><span class="tile" style="width:32px;height:32px;border-radius:16px"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></span><div><div style="font-size:20px;line-height:28px">Itemized statement</div><div>482 N. Glassell St, Unit B</div></div></div>
<div data-name="divider-row" data-expect="pass" style="display:flex;justify-content:space-between;border-top:1px solid #ddd;padding-top:10px">Returned in all<span>$2,060.00</span></div>
<div class="row start" data-name="ghost-button-level-with-title" data-expect="pass"><div style="flex:1"><div style="font-size:18px;line-height:28px">Add finding</div><div>Bedroom 1</div></div><span style="display:flex;height:28px;align-items:center;font-size:18px;line-height:28px"><button class="ghost"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></button></span></div>
<div class="row start" data-name="ghost-button-at-top" data-expect="miss"><div style="flex:1"><div style="font-size:18px;line-height:28px">Add finding</div><div>Bedroom 1</div></div><button class="ghost"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></button></div>
<div data-name="white-row-on-white" data-expect="pass" style="display:flex;height:48px;box-sizing:border-box;align-items:center;justify-content:space-between;background:#fff;border-top:1px solid #ddd;padding-top:4px">Refund due<span>$3,700.00</span></div>
</body></html>"""


def self_test(browser):
    """The measure on FIXTURE: each row must be judged as it is marked."""
    ctx = browser.new_context(viewport={"width": 420, "height": 900}, device_scale_factor=1)
    p = ctx.new_page()
    p.set_content(FIXTURE)
    res = p.evaluate(MEASURE, [None, TOL])
    rows = p.evaluate("() => [...document.querySelectorAll('[data-expect]')].map((e) => [e.dataset.name, e.dataset.expect])")
    flagged = {}
    for m in res["misses"]:
        flagged.setdefault(m["name"], []).append(f"{m['kind']} dy {m['dy']} dx {m['dx']}")
    wrong = [f"{n}: expected {e}, got {'; '.join(flagged[n]) if n in flagged else 'pass'}" for n, e in rows if (n in flagged) != (e == "miss")]
    check(f"the measure on its fixed page: {len(rows)} rows judged as marked (the welcome card's old row a miss, its fix a pass)", not wrong, "; ".join(wrong))
    ctx.close()
    return not wrong


# ---------- The pages ----------

def measure(page, view, width, crops, root=None):
    """Measure `root` (the whole page if None) and keep its misses; crop the first place of each new kind of miss."""
    global views
    page.evaluate("() => { window.__align = { els: [] }; }")
    res = page.evaluate(MEASURE, [root, TOL])
    if res.get("error"):
        check(f"{view} at {width} px: measured", False, res["error"])
        return
    views += 1
    for k in counted:
        counted[k] += res["stats"][k]
    for m in res["misses"]:
        m.update(view=view, width=width)
        misses.append(m)
        if m["sig"] in crops["seen"]:
            continue
        crops["seen"].add(m["sig"])
        clip = page.evaluate(CROP, m["id"])
        if clip:
            n = len(crops["seen"])
            path = crops["dir"] / f"{n:02d}-{re.sub(r'[^a-z0-9]+', '-', view.lower())}-{width}.png"
            page.screenshot(path=str(path), clip=clip)
            m["crop"] = str(path)


def audit(base, setup, shots):
    from playwright.sync_api import sync_playwright

    U = setup["units"]
    mo, closed, tx = U["move_out"], U["closed"], U["notice"]
    tenant_mo = setup["tenantPath"]
    crops = {"dir": shots / "misses", "seen": set()}
    crops["dir"].mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        if not self_test(browser):
            browser.close()
            return

        def context(width, cookie=True, welcome=False):
            ctx = browser.new_context(viewport=WIDTHS[width], reduced_motion="reduce", is_mobile=width != "1280", has_touch=width != "1280",
                                      device_scale_factor=1)
            if cookie:
                ctx.add_cookies([{"name": setup["cookie"]["name"], "value": setup["cookie"]["value"], "url": base}])
            if cookie and not welcome:
                ctx.add_cookies([{"name": "gf_welcome", "value": "seen", "url": base}])
            return ctx

        errors = []

        def open_page(ctx):
            p = ctx.new_page()
            p.set_default_timeout(30_000)
            p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            return p

        def go(p, path):
            p.goto(base + path, wait_until="networkidle")
            p.wait_for_timeout(300)

        # The pages, found the way a visitor finds them (as scripts/a11y-check.py does).
        desk = context("1280")
        page = open_page(desk)
        go(page, f"/tenancy/{closed}?tab=documents")
        notice_paths = sorted(set(page.eval_on_selector_all("a[href*='/notices/']", "as => as.map(a => new URL(a.href).pathname)")))
        go(page, f"/tenancy/{tx}?tab=documents")
        notice_paths += sorted(set(page.eval_on_selector_all("a[href*='/notices/']", "as => as.map(a => new URL(a.href).pathname)")) - set(notice_paths))
        go(page, f"/tenancy/{closed}?tab=move-out")
        tl = page.locator("a", has_text="Open the tenant's view").first
        tenant_closed = re.sub(r"^https?://[^/]+", "", tl.get_attribute("href")) if tl.count() else None
        check("the closed unit offers the tenants' view (its tenants' page)", bool(tenant_closed))
        page.close()

        landlord = [("properties", "/units"), ("tenants", "/tenants"), ("payments", "/ledger"), ("insights", "/insights"), ("documents", "/documents"),
                    ("lease-check", "/lease"), ("move-outs", "/move-outs")]
        for unit, uid in (("move-out-unit", mo), ("closed-unit", closed), ("texas-unit", tx)):
            for tab in ("overview", "move-out", "payments", "documents", "tenants"):
                landlord.append((f"{unit}-{tab}", f"/tenancy/{uid}" + ("" if tab == "overview" else f"?tab={tab}")))
        printable = [("move-out-unit-statement", f"/tenancy/{mo}/statement"), ("closed-unit-statement", f"/tenancy/{closed}/statement")]
        printable += [(f"notice-{p.rstrip('/').split('/')[-1]}-{'closed' if closed in p else 'texas'}", p) for p in notice_paths]
        landlord += printable + [("move-out-unit-refund-review", f"/tenancy/{mo}/refund"), ("closed-unit-refund-receipt", f"/tenancy/{closed}/refund"),
                                 ("not-found", "/tenancy/00000000-0000-4000-8000-000000000000")]
        tenant = [("tenants-page-move-out", tenant_mo)] + ([("tenants-page-closed", tenant_closed), ("tenants-dispute-closed", f"{tenant_closed}/dispute")] if tenant_closed else [])
        tenant.append(("tenants-not-found", "/t/" + "A" * 43))

        for width in ("1280", "390"):
            ctx = context(width)
            p = open_page(ctx)
            for name, path in landlord + tenant:
                go(p, path)
                measure(p, name, width, crops)
            ctx.close()
            ctx = context(width, cookie=False)
            p = open_page(ctx)
            go(p, "/access")
            measure(p, "access", width, crops)
            ctx.close()

        # The statements and notices as printed (their print styles).
        ctx = context("1280")
        p = open_page(ctx)
        p.emulate_media(media="print")
        for name, path in printable:
            go(p, path)
            measure(p, f"{name} (print)", "1280", crops)
        p.emulate_media(media="screen")

        # The header's menus, Start over, an info tip, a row's More, the Add finding drawer.
        go(p, "/units")
        for label in ("Notifications", "Help", "Account"):
            p.locator("header").get_by_role("button", name=label, exact=True).first.click()
            p.locator(".gf-pop[data-state=open]").wait_for()
            p.wait_for_timeout(150)
            measure(p, f"menu {label}", "1280", crops, ".gf-pop[data-state=open]")
            p.keyboard.press("Escape")
            p.wait_for_timeout(150)
        p.locator("header").get_by_role("button", name="Account", exact=True).first.click()
        p.get_by_role("button", name="Start over").click()
        p.get_by_role("alertdialog").wait_for()
        p.wait_for_timeout(150)
        measure(p, "dialog Start over", "1280", crops, "[role=alertdialog]")
        p.keyboard.press("Escape")
        go(p, f"/tenancy/{tx}")
        p.get_by_role("button", name=re.compile(r"^Rules: Tex")).first.focus()
        p.locator("[role=tooltip]").first.wait_for()
        measure(p, "info tip", "1280", crops, "[role=tooltip]")
        p.keyboard.press("Escape")
        p.get_by_role("button", name="More actions").first.click()
        p.locator(".gf-pop[data-state=open]").wait_for()
        p.wait_for_timeout(150)
        measure(p, "menu More actions", "1280", crops, ".gf-pop[data-state=open]")
        p.keyboard.press("Escape")
        go(p, f"/tenancy/{mo}?tab=move-out")
        p.get_by_role("button", name="Add finding").first.click()
        p.get_by_role("dialog").first.wait_for()
        p.wait_for_timeout(300)
        measure(p, "drawer Add finding", "1280", crops, "[role=dialog]")
        p.keyboard.press("Escape")
        ctx.close()

        # The welcome card and every stop of its tour, at both widths; the phone navigation at 390.
        for width in ("1280", "390"):
            ctx = context(width, welcome=True)
            p = open_page(ctx)
            go(p, "/units")
            p.locator("[data-welcome]").wait_for()
            measure(p, "welcome card", width, crops, "[data-welcome]")
            p.get_by_role("button", name="Show me around").click()
            for stop in range(1, 9):
                p.locator("[data-tour-stop]").wait_for()
                p.wait_for_timeout(300)
                measure(p, f"tour stop {stop}", width, crops, "[data-tour-stop]")
                nxt = p.locator("[data-tour-stop]").get_by_role("button", name="Next")
                if not nxt.count():
                    break
                nxt.click()
            p.keyboard.press("Escape")
            if width == "390":
                go(p, "/units")
                p.get_by_role("button", name="Open navigation").click()
                p.locator("[aria-label=Navigation]").wait_for()
                p.wait_for_timeout(300)
                measure(p, "phone navigation", width, crops, "[aria-label=Navigation]")
                p.locator("[aria-label=Navigation]").get_by_role("button", name=re.compile("Harbor View Rentals")).click()
                p.locator(".gf-pop[data-state=open]").wait_for()
                p.wait_for_timeout(150)
                measure(p, "phone navigation, account menu", width, crops, ".gf-pop[data-state=open]")
            ctx.close()

        # The tenants' dispute form with a refused value, and their advocate's case (stubbed): the delivery is recorded
        # first, as the tenants can dispute only once the statement is out.
        ctx = context("1280")
        p = open_page(ctx)
        go(p, f"/tenancy/{mo}/statement")
        p.get_by_role("button", name="Record delivery").first.click()
        p.get_by_role("dialog").get_by_role("button", name="In person").click()
        p.wait_for_timeout(150)
        measure(p, "dialog Record delivery", "1280", crops, "[role=dialog]")
        p.get_by_role("dialog").get_by_role("button", name="Record delivery").click()
        p.get_by_text("Open the tenant's view").first.wait_for(timeout=30_000)
        go(p, f"/tenancy/{mo}/refund")
        p.get_by_role("button", name="Prepare refund").click()
        p.get_by_role("button", name="Send refund").wait_for(timeout=90_000)
        p.wait_for_timeout(300)
        measure(p, "refund prepared", "1280", crops)
        ctx.close()
        for width in ("390", "1280"):
            ctx = context(width)
            p = open_page(ctx)
            go(p, f"/tenancy/{mo}/refund")
            if width == "390":
                measure(p, "refund prepared", width, crops)
            go(p, tenant_mo)
            measure(p, "tenants-page-delivered", width, crops)
            go(p, f"{tenant_mo}/dispute")
            if width == "390":
                p.get_by_text("Which charges?").wait_for()
                p.get_by_label("1. Bedroom carpet", exact=False).check()
                p.get_by_role("button", name="Ask my advocate").click()
                p.wait_for_timeout(300)
                measure(p, "tenants-dispute-form-error", width, crops)
                p.get_by_placeholder("What's wrong with this charge, in your words").fill("The stain was one small spot, and nobody asked us about cleaning it first.")
                p.get_by_label("Your name").select_option(label="Luke Jones")
                p.get_by_role("button", name="Ask my advocate").click()
            p.get_by_role("region", name="Your advocate's case").wait_for(timeout=90_000)
            p.wait_for_timeout(300)
            measure(p, "tenants-advocate-case", width, crops)
            ctx.close()

        check("no page error on the way", not errors, "; ".join(errors[:6]))
        browser.close()


def report():
    groups = {}
    for m in misses:
        groups.setdefault(m["sig"], []).append(m)
    ranked = sorted(groups.values(), key=lambda g: (-max(max(abs(m["dy"]), abs(m["dx"])) for m in g), -len(g)))
    for i, g in enumerate(ranked, 1):
        worst = max(g, key=lambda m: max(abs(m["dy"]), abs(m["dx"])))
        places = list(dict.fromkeys(f"{m['view']}@{m['width']}" for m in g))
        crop = next((m["crop"] for m in g if m.get("crop")), None)
        print(f"\nMISS {i}: {worst['kind']}, dy {worst['dy']:+} dx {worst['dx']:+} px (worst of {len(g)})")
        print(f"  mark:  {worst['frame'] or worst['mark']}" + (f"\n  glyph: {worst['mark']}" if worst["frame"] else ""))
        print(f"  row:   {worst['row']}")
        if worst["text"]:
            print(f"  text:  \"{worst['text']}\"")
        print(f"  where: {', '.join(places[:8])}{f' and {len(places) - 8} more' if len(places) > 8 else ''}")
        if crop:
            print(f"  crop:  {crop}")
    check(f"alignment: every mark centered on its text within {TOL} px ({views} views, {counted['pairs']} marks beside text, "
          f"{counted['frames']} glyphs in frames, {counted['labels']} labels in boxes)",
          views > 0 and not groups, f"{len(groups)} kinds of miss in {len(misses)} places (listed above)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--worktree", type=Path, help="make a temporary worktree here, build it, serve it on --port, check it, remove it")
    ap.add_argument("--serve", type=Path, help="serve this already-built directory on --port with the stubs on, check it, stop it")
    ap.add_argument("--port", type=int, default=e2e.PORT)
    ap.add_argument("--base", help="check a server already running with the stubs on (with --codes, or its secret and access code in the environment)")
    ap.add_argument("--codes", type=Path, help="with --base: the codes.json an e2e-demo.py --serve --hold server wrote")
    ap.add_argument("--shots", type=Path, help="where the crops of the misses and the server's log go (default: a new temporary folder)")
    ap.add_argument("--self-test", action="store_true", help="only run the measure on its fixed page of right and wrong rows (no server)")
    a = ap.parse_args()

    def stopped(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stopped)

    if a.self_test:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            ok = self_test(b)
            b.close()
        return 0 if ok else 1
    if sum(bool(x) for x in (a.worktree, a.serve, a.base)) != 1:
        ap.error("pass exactly one of --worktree, --serve, --base or --self-test")
    if a.worktree and a.worktree.exists():
        ap.error(f"{a.worktree} already exists: --worktree makes a new directory (and removes it afterwards)")
    shots = a.shots or Path(tempfile.mkdtemp(prefix="gf-align-"))
    shots.mkdir(parents=True, exist_ok=True)
    server, wt, made, setup, root = None, None, False, None, REPO
    try:
        if a.base:
            base = a.base.rstrip("/")
            saved = json.loads(a.codes.read_text()) if a.codes else {}
            codes = {"secret": saved.get("secret") or os.environ.get("GOOD_FAITH_SESSION_SECRET", ""), "access": saved.get("access") or os.environ.get("GOOD_FAITH_ACCESS_CODE", "")}
            if len(codes["secret"]) < 32 or not codes["access"]:
                raise RuntimeError("--base needs the running server's GOOD_FAITH_SESSION_SECRET and GOOD_FAITH_ACCESS_CODE (or --codes).")
        else:
            wt = a.worktree or a.serve
            if a.worktree:
                made = True
                e2e.make_worktree(wt)
                e2e.build(wt)
            root = wt
            codes = e2e.new_codes()
            server = e2e.start_server(wt, codes, shots / "server.log", a.port)
            base = f"http://localhost:{a.port}"
        up, stubbed = e2e.health(base)
        if not check("the server answers its health check", up):
            return 2
        if not check("the server says the e2e stubs are on, so no Claude or PayPal call can be real", stubbed, "refusing to check a server without the stubs"):
            return 2
        env = {**os.environ, "GOOD_FAITH_SESSION_SECRET": codes["secret"], "GOOD_FAITH_ACCESS_CODE": codes["access"]}
        setup = e2e.helper("setup", env=env, root=root)
        print(f"copy: workspace {setup['ws']}, units {json.dumps(setup['units'])}", flush=True)
        audit(base, setup, shots)
        report()
    except Exception as ex:
        check("the run finished without an error", False, f"{type(ex).__name__}: {ex}")
        if misses:
            report()
    finally:
        if setup:
            try:
                rep = e2e.helper("cleanup", setup["ws"], setup["sid"], root=root)
                check("clean-up: the copy, its rows and files, its fake deposit and its daily-limit rows are gone", rep["ok"], json.dumps(rep))
            except Exception as ex:
                check("clean-up", False, f"{ex}. Run: python scripts/e2e-demo.py --leftovers --apply")
        e2e.stop_server(server)
        if made:
            e2e.remove_worktree(wt)
            check("the temporary worktree is removed", not wt.exists())
        print(f"\ncrops of the misses and the server's log: {shots}")
        print(f"{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
