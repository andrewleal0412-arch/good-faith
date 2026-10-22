#!/usr/bin/env python3
"""Accessibility: every landlord page and the tenants' page held to WCAG 2.2 AA, at 1280 and 390 px, on a production
build with every model and PayPal stubbed.

The bar is zero serious or critical axe-core violations (the devDependency pinned in package.json, run with the WCAG
2.0, 2.1 and 2.2 A and AA rules and axe's best practices) on every page at both widths. Moderate and minor findings
are listed under the run, and the checks below cover what axe can't see:

  - Keyboard: Tab walks every page from the top. Each stop must show a focus indicator of at least 3:1 against what is
    around it (an outline, a ring, a border or a fill that changes on focus), sit on something visible, and not be
    hidden under the sticky bars; an outline must also be painted whole, not cut by a box that clips its overflow (a
    scroll box: each side keeps at least half its width), and the record tabs and the Payments views are counted in
    the pixels, all four sides. Every visible control must be reached, an AG Grid included (one stop, the arrow keys
    inside it, Tab out of it), and a control inside a grid's cell is pressed by Enter on the cell (a link, a row's
    menu, an info tip, a group's toggle: one of each kind of row and column, in each grid). Every info tip and Why? is
    named for what it explains.
  - Popovers: each menu (the bell, Help, the account, a row's More) opens from the keyboard, moves with the arrow keys,
    and Escape closes it and puts focus back on its button; Tab out of a popover goes on to the next control (out of a
    grid row's menu, back to its button, where the arrow keys go on through the grid). An info tip or a Why? opens on
    focus, is named by aria-describedby, stays open while the pointer moves onto it, and Escape closes it without
    moving focus.
  - Errors: on the tenants' dispute form a refused value is an alert, and the field it names is aria-invalid,
    described by it and focused.
  - Dialogs: the confirm dialog, a drawer and the phone navigation take focus in, keep Tab inside, close on Escape
    and give focus back to what opened them. A demo copy's welcome card and the card of its tour take focus on their
    main button and keep Tab inside, at 1280 and 390 px, and Escape ends the tour with focus on the page; on a phone,
    Welcome tour in the drawer's account menu closes the drawer before the card opens.
  - Reduced motion: with prefers-reduced-motion, no animation is running after a page loads, after a tab is switched
    and after a dialog or a menu opens, and nothing waits hidden for a moment to play.
  - Phones: at 390 px no page scrolls sideways (every target meets WCAG 2.5.8 through axe's target-size rule, which
    lets a smaller target pass on its spacing; those are listed), and on the tenants' pages every target is at least
    24 by 24 px with no spacing allowance, nothing is cut off, every amount and date is whole and at least 12 px, and
    their main actions are at least 40 px tall and full
    width (one-handed). At 320 px (a 1280 px window zoomed to 400%, WCAG 1.4.10) the tenants' pages and the landlord's
    main pages still don't scroll sideways.

The run, the checklist's (as scripts/e2e-demo.py, whose build, server and copy it reuses): a temporary worktree of HEAD
with this checkout's uncommitted changes laid over it, next build, next start on 3211 (or --port) with the stubs on, a
fresh test copy of the demo (made from the templates without a demo_copy_usage row or a real pool deposit, its
session signed locally, never the judges' code), the audit, then the copy, the server and the worktree removed:

  /path/to/python scripts/a11y-check.py --worktree /tmp/gf-a11y-wt --shots /tmp/gf-a11y-shots

  # Against a build already made or served (see scripts/e2e-demo.py --prepare and --serve --hold):
  python scripts/a11y-check.py --serve /tmp/gf-e2e-wt --shots /tmp/gf-a11y-shots
  python scripts/a11y-check.py --base http://localhost:3211 --codes /tmp/gf-e2e-hold/codes.json --shots /tmp/gf-a11y-shots

On the way it records the move-out unit's statement delivery, prepares its refund (the stubbed close-out agent) and
asks the tenants' advocate (stubbed), so the dispute form, the advocate's case and the prepared refund are audited too;
no money moves and no Claude call is made. A screenshot of every page at both widths, and axe's full report as JSON,
go to --shots. Prints one line per check, "PASS <name>" or "FAIL <name>: <detail>", and exits 1 if any failed (2 if
it couldn't run). Needs Playwright for Python with Chromium, and Node.
"""
import argparse
import base64
import importlib.util
import itertools
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

AXE = REPO / "node_modules/axe-core/axe.min.js"
TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa", "best-practice"]
BAR = ("serious", "critical")
WIDTHS = {"1280": {"width": 1280, "height": 900}, "390": {"width": 390, "height": 844}, "320": {"width": 320, "height": 640}}

failed = 0
passed = 0
notes = []  # moderate and minor axe findings: listed, not failed
bare_tips = []  # info tips and Why?s named only "More information" or "Why?", from every page walked


def check(name, ok, detail=""):
    global failed, passed
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"{'PASS' if ok else 'FAIL'} {name}{'' if ok else f': {detail}'}", flush=True)
    return ok


# ---------- In the page ----------

# Installed into every page (add_init_script): colors through a canvas (whatever CSS syntax the browser computes),
# WCAG's contrast ratio, the background behind an element (its ancestors' fills composited), and the styles a focus
# indicator can use, so a stop can be judged against the same element before it had focus.
HELPERS = r"""
(() => {
  if (window.__a11y) return;
  let ctx = null;
  const rgba = (c) => {
    if (!c || c === 'transparent') return [0, 0, 0, 0];
    if (!ctx) { const cv = document.createElement('canvas'); cv.width = cv.height = 1; ctx = cv.getContext('2d', { willReadFrequently: true }); }
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (t, u) => { const a = t[3]; return [t[0] * a + u[0] * (1 - a), t[1] * a + u[1] * (1 - a), t[2] * a + u[2] * (1 - a), 1]; };
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) { stack.push(c); if (c[3] >= 0.999) break; }
    }
    let col = [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i--) col = over(stack[i], col);
    return col;
  };
  const snap = (el) => {
    const s = getComputedStyle(el);
    return { ow: parseFloat(s.outlineWidth) || 0, os: s.outlineStyle, oc: s.outlineColor, oo: parseFloat(s.outlineOffset) || 0, bs: s.boxShadow,
      bc: s.borderBottomColor, bw: Math.max(parseFloat(s.borderBottomWidth) || 0, parseFloat(s.borderTopWidth) || 0), bg: s.backgroundColor, td: s.textDecorationLine };
  };
  const chain = (el) => [el, el.parentElement, el.parentElement && el.parentElement.parentElement].filter(Boolean);
  const srOnly = (el) => { const r = el.getBoundingClientRect(); return r.width <= 1.5 && r.height <= 1.5; };
  // What the eye sees for a focused element: itself; for a visually hidden input, its label (the file picker) or the
  // ring drawn beside it (data-focus-ring: the photo slider, an invisible range input over the photos).
  const proxy = (el) => {
    const ring = el.parentElement && [...el.parentElement.children].find((c) => c !== el && c.hasAttribute && c.hasAttribute('data-focus-ring'));
    if (ring) return ring;
    return (srOnly(el) && el.closest('label')) || el;
  };
  // AG Charts draws keyboard focus on its canvas's overlay (a path around the bar or point, a box around a legend item),
  // not on the element that holds focus.
  const chartRing = (el) => {
    const w = el.closest('.ag-charts-wrapper');
    if (!w) return null;
    for (const n of w.querySelectorAll('.ag-charts-focus-svg-inner-path, .ag-charts-focus-indicator > div')) {
      const r = n.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const c = n.tagName.toLowerCase() === 'path' ? rgba(s.stroke) : rgba((s.boxShadow.match(/(rgba?\([^)]*\))/) || [])[1]);
      const bg = bgOf(w);
      return { el: n, ratio: ratio(over(c, bg), bg) };
    }
    return { el: null, ratio: 0 };
  };
  // The sides of an element's outline that an ancestor clipping its overflow (a scroll box, overflow: hidden) cuts
  // away: each side must keep at least half its width (and a pixel) inside every clipping box on the way up. An
  // ancestor above a fixed element doesn't clip it. Null when the whole outline is painted.
  const clippedSides = (n, ow, oo) => {
    if (!(ow >= 1)) return null;
    const R = n.getBoundingClientRect();
    const band = {
      left: [R.left - oo - ow, R.left - oo], right: [R.right + oo, R.right + oo + ow],
      top: [R.top - oo - ow, R.top - oo], bottom: [R.bottom + oo, R.bottom + oo + ow],
    };
    let box = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity }, by = [];
    for (let c = n; c && c.parentElement && c !== document.body; c = c.parentElement) {
      if (getComputedStyle(c).position === 'fixed') break;
      const a = c.parentElement, cs = getComputedStyle(a);
      if (a === document.body || a === document.documentElement) break;
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      const pl = ar.left + a.clientLeft, pt = ar.top + a.clientTop;
      box = { l: Math.max(box.l, pl), t: Math.max(box.t, pt), r: Math.min(box.r, pl + a.clientWidth), b: Math.min(box.b, pt + a.clientHeight) };
      by.push(a);
    }
    if (!by.length) return null;
    const vis = (x0, x1, c0, c1) => Math.max(0, Math.min(x1, c1) - Math.max(x0, c0));
    const across = { left: vis(R.top, R.bottom, box.t, box.b), right: vis(R.top, R.bottom, box.t, box.b), top: vis(R.left, R.right, box.l, box.r), bottom: vis(R.left, R.right, box.l, box.r) };
    const keep = Math.max(1, ow / 2) - 0.01;
    const lost = Object.entries(band).filter(([k, [x0, x1]]) => {
      const t = k === 'left' || k === 'right' ? vis(x0, x1, box.l, box.r) : vis(x0, x1, box.t, box.b);
      return across[k] <= 0 || t < keep;
    }).map(([k]) => k);
    return lost.length ? { sides: lost, by: desc(by[0]) } : null;
  };
  const desc = (el) => {
    if (!el || el === document.body) return 'body';
    const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const role = el.getAttribute('role');
    const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.split(/\s+/).filter((c) => c.startsWith('ag-') || c.startsWith('gf-')).slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ''}${cls === '.' ? '' : cls} "${name}"`;
  };
  const FOCUSABLE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable=true]';
  const tabbable = (el) => {
    if (el.matches(':disabled') || el.closest('[inert]') || el.closest('[aria-hidden=true]')) return false;
    if (el.tabIndex < 0) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    const r = proxy(el).getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return false;
    // Inside a closed <details>, or an AG Grid's cells (one stop for the grid, judged on its own).
    if (el.closest('details:not([open])') && !el.matches('summary')) return false;
    return true;
  };
  let base = new Map(), seq = 0;
  window.__a11y = {
    rgba, ratio, bgOf, desc, proxy,
    // The page as it stands with nothing focused: every tabbable element numbered, its styles noted (two frames after
    // the walk's start took focus from whatever had it, so a field's focus styles have gone).
    async baseline() {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const out = [];
      for (const el of document.querySelectorAll(FOCUSABLE)) {
        if (!tabbable(el)) continue;
        if (!el.dataset.a11y) el.dataset.a11y = String(++seq);
        base.set(el.dataset.a11y, chain(proxy(el)).map(snap));
        out.push({ i: el.dataset.a11y, d: desc(el), grid: !!el.closest('.ag-root-wrapper'), chart: !!el.closest('.ag-charts-wrapper') });
      }
      return out;
    },
    // Where a walk starts: a mark at the very top of the page, so the first Tab goes to the page's first control
    // whatever had focus before (an autofocused field).
    start() {
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      let m = document.getElementById('__a11y-start');
      if (!m) { m = document.createElement('span'); m.id = '__a11y-start'; m.tabIndex = -1; document.body.prepend(m); }
      m.focus();
    },
    // The element with focus now: who it is, whether the eye can see it, and the best focus indicator it shows. Read
    // two frames after the key, once the focus styles' transitions (0.01 ms with reduced motion) have landed.
    async stop() {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement || el.id === '__a11y-start') return null;
      const chart = chartRing(el);
      if (chart) {
        const r = chart.el ? chart.el.getBoundingClientRect() : null;
        const vis = r && r.bottom > 0 && r.top < innerHeight ? null : 'off screen';
        return { i: el.dataset.a11y || null, d: desc(el), vis: null, hidden: chart.el ? vis : 'no focus drawn on the chart', ind: chart.el ? { how: 'chart', depth: 0, ratio: Math.round(chart.ratio * 100) / 100 } : null, grid: false, chart: true, tag: el.tagName.toLowerCase() };
      }
      const p = proxy(el);
      const r = p.getBoundingClientRect();
      const s = getComputedStyle(p);
      let vis = null;
      if (r.width < 1 && r.height < 1) vis = 'zero size';
      else if (s.visibility === 'hidden' || parseFloat(s.opacity) === 0) vis = 'invisible';
      let hidden = null;
      const pts = [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]].map(([x, y]) => [r.left + r.width * x, r.top + r.height * y])
        .filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
      if (!pts.length) hidden = 'off screen';
      else if (!pts.some(([x, y]) => { const h = document.elementFromPoint(x, y); return h && (h === p || p.contains(h) || h.contains(p)); })) {
        const h = document.elementFromPoint(pts[0][0], pts[0][1]);
        hidden = `under ${desc(h)}`;
      }
      const was = el.dataset.a11y ? base.get(el.dataset.a11y) : null;
      let best = null;
      const consider = (how, depth, r2) => { if (!best || r2 > best.ratio) best = { how, depth, ratio: Math.round(r2 * 100) / 100 }; };
      chain(p).forEach((n, depth) => {
        const now = snap(n), prev = was ? was[depth] : null;
        const out = bgOf(n.parentElement || n), inside = bgOf(n);
        if (now.os !== 'none' && now.ow >= 1 && (!prev || prev.os === 'none' || prev.ow < 1 || prev.oc !== now.oc)) {
          const c = rgba(now.oc), against = now.oo >= 0 ? out : inside;
          consider('outline', depth, ratio(over(c, against), against));
        }
        if (now.bs !== 'none' && (!prev || prev.bs !== now.bs)) {
          for (const m of now.bs.matchAll(/(rgba?\([^)]*\)|color\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)|lab\([^)]*\)|#[0-9a-f]{3,8})/gi)) {
            const c = rgba(m[1]);
            if (c[3] > 0.05) consider('ring', depth, ratio(over(c, out), out));
          }
        }
        if (prev && prev.bc !== now.bc && now.bw >= 1) {
          const c = over(rgba(now.bc), out);
          consider('border', depth, Math.min(ratio(c, out), Math.max(ratio(c, over(rgba(prev.bc), out)), ratio(c, inside))));
        }
        if (prev && prev.bg !== now.bg) consider('fill', depth, ratio(over(rgba(now.bg), out), over(rgba(prev.bg), out)));
        if (prev && prev.td !== now.td && now.td.includes('underline')) consider('underline', depth, 4.5);
      });
      // An outline is painted, not only styled: the sides a box that clips its overflow cuts away.
      let cut = null;
      if (best && best.how === 'outline') {
        const n = chain(p)[best.depth], s2 = snap(n);
        cut = clippedSides(n, s2.ow, s2.oo);
      }
      return { i: el.dataset.a11y || null, d: desc(el), vis, hidden, ind: best, cut, grid: !!el.closest('.ag-root-wrapper'), chart: false, tag: el.tagName.toLowerCase() };
    },
    // What is animating now (Web Animations: CSS animations and transitions, and every script's el.animate()).
    running() {
      return document.getAnimations().filter((a) => a.playState === 'running' || (a.playState === 'paused' && (a.currentTime ?? 0) === 0 && !(a instanceof CSSTransition)))
        .map((a) => ({ name: a.animationName || a.transitionProperty || a.id || 'script', state: a.playState, on: desc(a.effect && a.effect.target) }));
    },
  };
})();
"""

# The phone checks on the tenants' pages: sideways scroll, text cut off, amounts and dates whole and big enough,
# targets big enough, the main actions thumb-sized.
PHONE = r"""
() => {
  const de = document.documentElement;
  const out = { sideways: Math.max(de.scrollWidth, document.body.scrollWidth) - de.clientWidth, cut: [], small: [], targets: [], actions: [] };
  const vw = de.clientWidth;
  const MONEY = /\$\s?[0-9][0-9,]*\.[0-9]{2}/, DATE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* [0-9]{1,2}(, [0-9]{4})?\b/;
  const walker = document.createTreeWalker(document.querySelector('main') || document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const s = t.textContent.trim();
    if (!s) continue;
    const el = t.parentElement;
    if (!el || el.closest('[aria-hidden=true], .sr-only, [role=tooltip]') || !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    const range = document.createRange(); range.selectNodeContents(t);
    const rects = [...range.getClientRects()];
    if (!rects.length) continue;
    const key = MONEY.test(s) || DATE.test(s);
    for (const r of rects) if (r.right > vw + 0.5 || r.left < -0.5) { out.cut.push(`"${s.slice(0, 50)}" runs off screen (${Math.round(r.left)} to ${Math.round(r.right)})`); break; }
    // Clipped by a box that cuts its overflow (truncate): an amount or a date must never be.
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if ((cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') && n.scrollWidth > n.clientWidth + 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
        if (key) out.cut.push(`"${s.slice(0, 50)}" is cut off by its box`);
        break;
      }
    }
    if (key && parseFloat(getComputedStyle(el).fontSize) < 12) out.small.push(`"${s.slice(0, 40)}" at ${getComputedStyle(el).fontSize}`);
  }
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]')) {
    if (el.closest('[inert], [aria-hidden=true]') || !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    // A visually hidden input is touched through its label, and so is a checkbox or a radio its label wraps: the label
    // is the target (clicking it sets the box).
    const wrap = el.closest('label');
    const p = ((el.getBoundingClientRect().width <= 1.5 || /^(checkbox|radio)$/.test(el.type || '')) && wrap) || el;
    const r = p.getBoundingClientRect();
    // Visually hidden until it has focus (the skip link): nothing to touch.
    if (r.width <= 2 && r.height <= 2) continue;
    // A link inside a sentence is exempt (WCAG 2.5.8, inline); everything else needs 24 by 24.
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && /\S/.test((el.parentElement.innerText || '').replace(el.innerText, ''));
    if (!inline && (r.width < 23.5 || r.height < 23.5)) out.targets.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (el.matches('.bg-brand, [data-main-action]')) out.actions.push({ name: (el.innerText || '').trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), full: r.width >= vw * 0.8 });
  }
  return out;
}
"""


# The info tips and Why?s on the page whose name doesn't say what they explain (a screen reader tabbing a statement
# would hear "More information" sixteen times).
TIP_NAMES = r"""
() => [...document.querySelectorAll('button[data-tip]')]
  .filter((b) => b.checkVisibility({ checkVisibilityCSS: true }))
  .map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim())
  .filter((n) => /^(More information|Why\?)?$/.test(n))
"""

# The cells of a grid that hold a control (a link, a row's menu, an info tip, a group's toggle), one of each kind of
# row and column: with the grid one Tab stop, each must be pressed by Enter on its cell.
GRID_CELLS = r"""
(sel) => {
  const g = document.querySelector(sel);
  if (!g) return [];
  const seen = new Set(), out = [];
  for (const cell of g.querySelectorAll('.ag-row .ag-cell')) {
    const c = cell.querySelector('button, a[href]');
    if (!c || !c.checkVisibility({ checkVisibilityCSS: true })) continue;
    const row = cell.closest('.ag-row');
    const kind = c.matches('[data-tip]') ? 'tip' : c.matches('[aria-haspopup]') ? 'menu' : c.matches('a[href]') ? 'link' : c.hasAttribute('aria-expanded') ? 'toggle' : 'button';
    const rk = [...row.classList].filter((x) => x.startsWith('gf-')).sort().join('.') || (row.classList.contains('ag-row-pinned') ? 'pinned' : 'row');
    const key = `${cell.getAttribute('col-id')} cell, ${rk} row, ${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, row: row.getAttribute('row-index'), col: cell.getAttribute('col-id'), kind, name: (c.getAttribute('aria-label') || c.innerText || '').trim().slice(0, 50) });
  }
  return out;
}
"""

# What a press can open, to tell that Enter on a cell did something.
OPENED = r"""
([sel, row, col]) => {
  const cell = document.querySelector(`${sel} .ag-row[row-index="${row}"] .ag-cell[col-id="${col}"]`);
  const a = document.activeElement;
  const d = a && a.getAttribute('aria-describedby');
  return {
    url: location.pathname + location.search,
    dialog: [...document.querySelectorAll('[role=dialog], [role=alertdialog]')].filter((x) => x.checkVisibility() && !x.closest('[inert]')).length,
    menu: document.querySelectorAll('.gf-pop[data-state=open]').length,
    tip: !!d && document.getElementById(d)?.getAttribute('role') === 'tooltip',
    expanded: cell?.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') ?? null,
  };
}
"""

# Brand pixels in the four bands around an element in a screenshot of it with an 8px margin: a focus outline that is
# painted shows on every side.
RING = r"""
async ([b64, ex, ey, w, h]) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const brand = (px, py) => { const i = (py * c.width + px) * 4; return Math.abs(d[i] - 94) < 28 && Math.abs(d[i + 1] - 106) < 28 && Math.abs(d[i + 2] - 210) < 28; };
  const count = (x0, x1, y0, y1) => { let n = 0; for (let yy = Math.max(0, y0); yy < Math.min(c.height, y1); yy++) for (let xx = Math.max(0, x0); xx < Math.min(c.width, x1); xx++) if (brand(xx, yy)) n++; return n; };
  return {
    top: count(ex + 3, ex + w - 3, ey - 4, ey + 4) / (w - 6), bottom: count(ex + 3, ex + w - 3, ey + h - 4, ey + h + 4) / (w - 6),
    left: count(ex - 4, ex + 4, ey + 3, ey + h - 3) / (h - 6), right: count(ex + w - 4, ex + w + 4, ey + 3, ey + h - 3) / (h - 6),
  };
}
"""


def painted_ring(page, loc, shots, name):
    """Focus `loc` from the keyboard, screenshot it with a margin, and count the outline's brand pixels on each side
    (in lines: 1 is one whole line of the side's length)."""
    loc.focus()
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Tab")
    page.wait_for_timeout(250)
    bx = loc.bounding_box()
    m = 8
    clip = {"x": max(0, bx["x"] - m), "y": max(0, bx["y"] - m), "width": bx["width"] + 2 * m, "height": bx["height"] + 2 * m}
    png = page.screenshot(clip=clip)
    (shots / "focus").mkdir(exist_ok=True)
    (shots / "focus" / f"{name}.png").write_bytes(png)
    sides = page.evaluate(RING, [base64.b64encode(png).decode(), round(bx["x"] - clip["x"]), round(bx["y"] - clip["y"]), round(bx["width"]), round(bx["height"])])
    return {k: round(v, 2) for k, v in sides.items()}


# ---------- The audit ----------

def axe(page, shots, name, width):
    page.add_script_tag(path=str(AXE))
    res = page.evaluate("""async (tags) => {
      const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
      const brief = (v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(' '), why: (n.failureSummary || '').replace(/\\s+/g, ' ').slice(0, 300) })), count: v.nodes.length });
      return { violations: r.violations.map(brief), incomplete: r.incomplete.filter((v) => v.id === 'color-contrast').map(brief) };
    }""", TAGS)
    (shots / "axe").mkdir(exist_ok=True)
    (shots / "axe" / f"{name}-{width}.json").write_text(json.dumps(res, indent=1))
    bad = [v for v in res["violations"] if v["impact"] in BAR]
    for v in res["violations"]:
        if v["impact"] not in BAR:
            notes.append(f"{name} at {width}: {v['impact']} {v['id']} ({v['help']}), {v['count']} node(s): {v['nodes'][0]['target']}")
    check(f"axe, {name} at {width} px: no serious or critical violation", not bad,
          "; ".join(f"{v['impact']} {v['id']} ({v['help']}) x{v['count']}: " + " | ".join(f"{n['target']} -> {n['why'][:160]}" for n in v["nodes"][:3]) for v in bad))
    return res


def walk(page, name, width, limit=260):
    """Tab from the top of the page to its end, judging every stop."""
    page.evaluate("() => window.scrollTo(0, 0)")
    # The pointer out of the way, so no tip it happens to rest on (after a click) covers what Tab reaches.
    page.mouse.move(0, 0)
    page.wait_for_timeout(250)  # past an info tip's hover grace
    page.evaluate("() => window.__a11y.start()")
    cands = page.evaluate("() => window.__a11y.baseline()")
    seen, stops, issues = set(), [], []
    first = None
    ended = False
    for _ in range(limit):
        page.keyboard.press("Tab")
        s = page.evaluate("() => window.__a11y.stop()")
        if s is None:
            ended = True
            break
        key = s["i"] or s["d"]
        if first is None:
            first = key
        elif key == first:
            ended = True
            break
        stops.append(s)
        seen.add(s["i"])
        if s["vis"]:
            issues.append(f"focus on something not seen ({s['vis']}): {s['d']}")
        elif s["hidden"]:
            issues.append(f"focus hidden ({s['hidden']}): {s['d']}")
        ind = s["ind"]
        if not ind:
            issues.append(f"no focus indicator: {s['d']}")
        elif ind["ratio"] < 3:
            issues.append(f"focus indicator too faint ({ind['how']}, {ind['ratio']}:1): {s['d']}")
        elif s.get("cut"):
            issues.append(f"focus outline cut off on its {', '.join(s['cut']['sides'])} by {s['cut']['by']}: {s['d']}")
    # Every visible control on the page was reached (an AG Grid's cells are one stop: some cell of each grid).
    missed = [c["d"] for c in cands if c["i"] not in seen and not c["grid"] and not c["chart"]] if ended else []
    grids = page.locator(".ag-root-wrapper").count()
    grid_stops = len({s["d"] for s in stops if s["grid"]})
    in_grid_run = max((sum(1 for _ in g) for k, g in itertools.groupby(stops, key=lambda s: s["grid"]) if k), default=0)
    check(f"keyboard, {name} at {width} px: {len(stops)} stops, each visible with a focus indicator of 3:1 or more, painted whole", not issues, "; ".join(dict.fromkeys(issues)))
    # Every info tip and Why? on the page is named for what it explains, not only "More information" or "Why?".
    bare_tips.extend(f"{name} at {width}: {n}" for n in page.evaluate(TIP_NAMES))
    if ended:
        check(f"keyboard, {name} at {width} px: every visible control is reached by Tab", not missed, "; ".join(missed[:12]))
    else:
        check(f"keyboard, {name} at {width} px: Tab reaches the end of the page in {limit} presses", False, f"still going after {limit}: the last stops {[s['d'] for s in stops[-5:]]}")
    charts = page.locator(".ag-charts-wrapper").count()
    if charts:
        chart_stops = sum(1 for s in stops if s.get("chart"))
        check(f"keyboard, {name} at {width} px: Tab reaches the charts ({charts} chart(s), {chart_stops} stop(s))", chart_stops >= 1, f"{chart_stops} chart stops")
    if grids:
        check(f"keyboard, {name} at {width} px: each AG Grid takes focus from Tab and lets it go ({grids} grid(s), {grid_stops} cell stop(s) in a row at most {in_grid_run})",
              grid_stops >= 1 and in_grid_run <= grids * 2, f"{grid_stops} cell stops, {in_grid_run} in a row")
    return stops


def motion_still(page, what):
    page.wait_for_timeout(60)
    run = page.evaluate("() => window.__a11y.running()")
    check(f"reduced motion, {what}: nothing animates", not run, json.dumps(run[:6]))


def phone(page, name, tenant):
    r = page.evaluate(PHONE)
    check(f"390 px, {name}: no sideways scroll", r["sideways"] <= 0, f"the page is {r['sideways']} px wider than the screen")
    if not tenant:
        # On the landlord's pages WCAG 2.5.8 is axe's target-size rule (in the bar): a target under 24 px passes when
        # nothing else is within its 24 px circle. Those are listed, not failed.
        if r["targets"]:
            notes.append(f"{name} at 390: {len(r['targets'])} target(s) under 24 px that pass on spacing: " + "; ".join(r["targets"][:6]))
        return
    check(f"390 px, {name}: every target at least 24 by 24 px", not r["targets"], "; ".join(r["targets"][:10]))
    check(f"390 px, {name}: nothing cut off, every amount and date whole", not r["cut"], "; ".join(r["cut"][:8]))
    check(f"390 px, {name}: every amount and date at 12 px or more", not r["small"], "; ".join(r["small"][:8]))
    thin = [a for a in r["actions"] if a["h"] < 40 or not a["full"]]
    check(f"390 px, {name}: the main actions are thumb-sized (40 px tall, full width)", not thin, json.dumps(thin))


def audit(base, setup, shots):
    from playwright.sync_api import sync_playwright

    U = setup["units"]
    mo, closed, tx = U["move_out"], U["closed"], U["notice"]
    tenant_mo = setup["tenantPath"]

    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        def context(width, reduce=True, cookie=True, welcome=False):
            ctx = browser.new_context(viewport=WIDTHS[width], reduced_motion="reduce" if reduce else "no-preference",
                                      is_mobile=width != "1280", has_touch=width != "1280", device_scale_factor=1)
            if cookie:
                ctx.add_cookies([{"name": setup["cookie"]["name"], "value": setup["cookie"]["value"], "url": base}])
            # A browser that has seen the welcome card (components/demo-welcome.tsx), unless the check is of the card.
            if cookie and not welcome:
                ctx.add_cookies([{"name": "gf_welcome", "value": "seen", "url": base}])
            ctx.add_init_script(HELPERS)
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

        def shot(p, name, width):
            p.evaluate("() => window.scrollTo(0, 0)")
            p.screenshot(path=str(shots / f"{name}-{width}.png"), full_page=True)

        # The pages, found the way a visitor finds them: the sidebar's, each property's five tabs, and the links the
        # property pages give (the statement, the refund review, the notices, the tenants' view).
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
        landlord += [("move-out-unit-statement", f"/tenancy/{mo}/statement"), ("closed-unit-statement", f"/tenancy/{closed}/statement"),
                     ("move-out-unit-refund-review", f"/tenancy/{mo}/refund"), ("closed-unit-refund-receipt", f"/tenancy/{closed}/refund"),
                     ("not-found", "/tenancy/00000000-0000-4000-8000-000000000000")]
        landlord += [(f"notice-{p.rstrip('/').split('/')[-1]}-{'closed' if closed in p else 'texas'}", p) for p in notice_paths]
        tenant = [("tenants-page-move-out", tenant_mo)] + ([("tenants-page-closed", tenant_closed), ("tenants-dispute-closed", f"{tenant_closed}/dispute")] if tenant_closed else [])
        tenant.append(("tenants-not-found", "/t/" + "A" * 43))

        def sweep(pages, width, kind):
            ctx = context(width)
            p = open_page(ctx)
            for name, path in pages:
                go(p, path)
                axe(p, shots, name, width)
                motion_still(p, f"{name} at {width} px, after it loads")
                if width == "390":
                    phone(p, name, kind == "tenant")
                if width == "1280" or kind == "tenant" or name in ("properties", "move-out-unit-overview", "move-out-unit-move-out"):
                    walk(p, name, width)
                shot(p, name, width)
            ctx.close()

        for width in ("1280", "390"):
            sweep(landlord, width, "landlord")
            sweep(tenant, width, "tenant")

        # Reflow (WCAG 1.4.10): at 320 px, a 1280 px window zoomed to 400%, the tenants' pages and the landlord's main
        # pages still read without scrolling sideways.
        ctx = context("320")
        p = open_page(ctx)
        for name, path in tenant[:-1] + [("properties", "/units"), ("move-out-unit-overview", f"/tenancy/{mo}"), ("move-out-unit-move-out", f"/tenancy/{mo}?tab=move-out"), ("payments", "/ledger")]:
            go(p, path)
            r = p.evaluate(PHONE)
            check(f"320 px, {name}: no sideways scroll (reflow)", r["sideways"] <= 0, f"the page is {r['sideways']} px wider than the screen")
            if name.startswith("tenants"):
                check(f"320 px, {name}: nothing cut off, every amount and date whole", not r["cut"], "; ".join(r["cut"][:8]))
        ctx.close()

        # The access page, with no session.
        for width in ("1280", "390"):
            ctx = context(width, cookie=False)
            p = open_page(ctx)
            go(p, "/access")
            axe(p, shots, "access", width)
            walk(p, "access", width)
            if width == "390":
                phone(p, "access", True)
            shot(p, "access", width)
            ctx.close()

        # The record tabs and the Payments views, the demo's most used controls: the keyboard's outline painted whole
        # on all four sides (their row scrolls sideways and clips anything drawn outside a tab), counted in the pixels.
        for width in ("1280", "390"):
            ctx = context(width)
            p = open_page(ctx)
            rings = {}
            go(p, f"/tenancy/{mo}")
            tabs = p.get_by_role("navigation", name="Sections").get_by_role("link")
            for i in sorted({0, 1, tabs.count() - 1}):
                rings[f"record tab {i + 1}"] = painted_ring(p, tabs.nth(i), shots, f"record-tab-{i + 1}-{width}")
            go(p, "/ledger")
            views = p.get_by_role("navigation", name="Views").get_by_role("button")
            for i in sorted({0, views.count() - 1}):
                rings[f"Payments view {i + 1}"] = painted_ring(p, views.nth(i), shots, f"payments-view-{i + 1}-{width}")
            thin = {k: v for k, v in rings.items() if min(v.values()) < 0.9}
            check(f"focus painted, {width} px: the record tabs and the Payments views show the whole outline, all four sides ({len(rings)} tabs)",
                  bool(rings) and not thin, json.dumps(thin or rings))
            ctx.close()

        # ---------- Popovers, dialogs, the grids, at 1280 ----------
        ctx = context("1280")
        p = open_page(ctx)

        def focus_and(locator, key="Enter"):
            locator.focus()
            p.keyboard.press(key)
            p.wait_for_timeout(120)

        def active():
            return p.evaluate("() => window.__a11y.desc(document.activeElement)")

        def in_(sel):
            return p.evaluate("(s) => !!document.activeElement && !!document.activeElement.closest(s)", sel)

        go(p, "/units")
        for label in ("Notifications", "Help", "Account"):
            btn = p.locator("header").get_by_role("button", name=label, exact=True).first
            focus_and(btn)
            pop = p.locator(".gf-pop[data-state=open]")
            opened = pop.count() == 1
            inside = in_(".gf-pop")
            items = pop.locator("a[href], button:not([disabled])").count()
            before = active()
            p.keyboard.press("ArrowDown")
            # With nothing to choose (an empty bell), focus is on the popover itself and there is nowhere to move.
            moved = (active() != before or items == 1) and in_(".gf-pop") if items else in_(".gf-pop")
            axe(p, shots, f"menu-{label.lower()}", "1280")
            motion_still(p, f"the {label} menu open")
            p.keyboard.press("Escape")
            p.wait_for_timeout(120)
            back = p.evaluate("(l) => document.activeElement?.getAttribute('aria-label') === l", label)
            check(f"menu {label}: Enter opens it with focus inside, the arrow keys move, Escape closes it and focus is back on its button",
                  opened and inside and moved and back and p.locator(".gf-pop").count() == 0, json.dumps({"opened": opened, "inside": inside, "moved": moved, "back": back}))

        # Leaving a popover with Tab: past Help's last link, focus goes on to the account button; Shift+Tab out of it
        # (from its first link to its button, then on) goes back to the bell; it closes either way, and the Tab isn't lost.
        aria = "() => document.activeElement?.getAttribute('aria-label')"
        help_ = p.locator("header").get_by_role("button", name="Help", exact=True).first
        focus_and(help_)
        p.keyboard.press("End")
        p.keyboard.press("Tab")
        p.wait_for_timeout(200)
        fwd = {"now": p.evaluate(aria), "open": p.locator(".gf-pop[data-state=open]").count()}
        focus_and(help_)
        p.keyboard.press("Shift+Tab")
        p.keyboard.press("Shift+Tab")
        p.wait_for_timeout(200)
        bwd = {"now": p.evaluate(aria), "open": p.locator(".gf-pop[data-state=open]").count()}
        check("popover Help: Tab past its last link goes on to Account, Shift+Tab out of it goes back to Notifications, and it closes",
              fwd == {"now": "Account", "open": 0} and bwd == {"now": "Notifications", "open": 0}, json.dumps({"tab": fwd, "shift+tab": bwd}))

        # The confirm dialog (Start over, from the account menu: Cancel leaves the copy as it is).
        acct = p.locator("header").get_by_role("button", name="Account", exact=True).first
        focus_and(acct)
        p.get_by_role("button", name="Start over").focus()
        p.keyboard.press("Enter")
        p.wait_for_timeout(150)
        dlg = p.get_by_role("alertdialog")
        ok_open = dlg.count() == 1 and in_("[role=alertdialog]")
        on_cancel = active().endswith('"Cancel"')
        trapped = True
        for _ in range(6):
            p.keyboard.press("Tab")
            trapped = trapped and in_("[role=alertdialog]")
        for _ in range(3):
            p.keyboard.press("Shift+Tab")
            trapped = trapped and in_("[role=alertdialog]")
        axe(p, shots, "dialog-start-over", "1280")
        motion_still(p, "the Start over dialog open")
        p.keyboard.press("Escape")
        p.wait_for_timeout(150)
        back = p.evaluate("() => document.activeElement?.getAttribute('aria-label') === 'Account'")
        check("dialog Start over: focus starts on Cancel, Tab and Shift+Tab stay inside, Escape closes it and focus is back on the account button",
              ok_open and on_cancel and trapped and back and dlg.count() == 0, json.dumps({"open": ok_open, "cancel": on_cancel, "trapped": trapped, "back": back}))

        # The welcome card and its tour (components/demo-welcome.tsx), in a browser that hasn't seen them, at both widths:
        # the card takes focus on its main button and keeps Tab inside, the tour's card takes it on Next and keeps it
        # there too, both pass axe and stand still under reduced motion, and Escape ends the tour with focus on the page.
        for width in ("1280", "390"):
            wctx = context(width, welcome=True)
            wp = open_page(wctx)
            go(wp, "/units")
            within = lambda sel: wp.evaluate("(s) => !!document.activeElement && !!document.activeElement.closest(s)", sel)
            on = lambda: wp.evaluate("() => document.activeElement?.textContent?.trim()")
            card = wp.locator("[data-welcome]")
            ok_card = card.count() == 1 and card.is_visible() and on() == "Show me around"
            card_trap = True
            for key in ["Tab"] * 4 + ["Shift+Tab"] * 3:
                wp.keyboard.press(key)
                card_trap = card_trap and within("[data-welcome]")
            axe(wp, shots, "dialog-welcome", width)
            motion_still(wp, f"the welcome card open at {width} px")
            wp.screenshot(path=str(shots / f"dialog-welcome-{width}.png"))
            wp.get_by_role("button", name="Show me around").click()
            wp.locator("[data-tour-stop]").wait_for()
            wp.wait_for_timeout(300)
            ok_tour = on() == "Next" and within("[data-tour-stop]")
            tour_trap = True
            for key in ["Tab"] * 4 + ["Shift+Tab"] * 3:
                wp.keyboard.press(key)
                tour_trap = tour_trap and within("[data-tour-stop]")
            axe(wp, shots, "tour-stop", width)
            motion_still(wp, f"the tour's first stop at {width} px")
            wp.screenshot(path=str(shots / f"tour-stop-{width}.png"))
            wp.keyboard.press("Escape")
            wp.wait_for_timeout(200)
            ended = wp.locator("[data-tour-stop]").count() == 0 and wp.evaluate("() => document.activeElement?.id") == "main"
            check(f"dialog welcome, {width} px: the card opens on Show me around and keeps Tab inside; the tour's card takes focus on Next and keeps it; Escape ends the tour with focus on the page",
                  ok_card and card_trap and ok_tour and tour_trap and ended,
                  json.dumps({"card": ok_card, "card trap": card_trap, "tour": ok_tour, "tour trap": tour_trap, "ended": ended}))
            if width == "390":
                # On a phone the account menu is inside the navigation drawer: Welcome tour there closes the drawer, so
                # the card opens over the page and not under the drawer.
                wp.get_by_role("button", name="Open navigation").click()
                wp.wait_for_timeout(150)
                wp.locator("[aria-label=Navigation]").get_by_role("button", name=re.compile("Harbor View Rentals")).click()
                wp.get_by_role("button", name="Welcome tour").click()
                wp.locator("[data-welcome]").wait_for()
                wp.wait_for_timeout(300)
                over = {"drawer": wp.locator("[aria-label=Navigation][aria-modal=true]").count(), "card": wp.locator("[data-welcome]").is_visible(),
                        "focus": on()}
                check("dialog welcome, 390 px: Welcome tour in the drawer's account menu closes the drawer and opens the card with focus on Show me around",
                      over == {"drawer": 0, "card": True, "focus": "Show me around"}, json.dumps(over))
            wctx.close()

        # An info tip: the Texas unit's Rules chip.
        go(p, f"/tenancy/{tx}")
        chip = p.get_by_role("button", name=re.compile(r"^Rules: Tex")).first
        chip.focus()
        p.wait_for_timeout(100)
        tip = p.locator("[role=tooltip]")
        named = p.evaluate("() => { const d = document.activeElement?.getAttribute('aria-describedby'); return !!d && !!document.getElementById(d) && document.getElementById(d).getAttribute('role') === 'tooltip'; }")
        shown = tip.count() == 1
        p.keyboard.press("Escape")
        p.wait_for_timeout(100)
        gone = tip.count() == 0
        still = active().startswith("button") and "Rules" in active()
        chip.hover()
        p.wait_for_timeout(100)
        box = tip.first.bounding_box() if tip.count() else None
        if box:
            p.mouse.move(box["x"] + box["width"] / 2, box["y"] + 6, steps=8)
            p.wait_for_timeout(250)
        hoverable = tip.count() == 1
        check("info tip: opens on focus and names itself by aria-describedby, Escape closes it with focus kept, and it stays open while the pointer moves onto it",
              shown and named and gone and still and hoverable, json.dumps({"shown": shown, "named": named, "escape": gone, "focus kept": still, "hoverable": hoverable}))
        p.mouse.move(5, 5)
        p.wait_for_timeout(250)

        # The record header's More, a menu in the page: Tab closes it and goes on to the next control (WAI-ARIA's menu
        # button), Shift+Tab closes it back on its button.
        more = p.get_by_role("button", name="More actions").first
        focus_and(more)
        inside = in_(".gf-pop")
        p.keyboard.press("Tab")
        p.wait_for_timeout(200)
        fwd = {"inside": inside, "now": active(), "on button": p.evaluate(aria) == "More actions", "in menu": in_(".gf-pop"), "open": p.locator(".gf-pop[data-state=open]").count()}
        focus_and(more)
        p.keyboard.press("Shift+Tab")
        p.wait_for_timeout(200)
        bwd = {"on button": p.evaluate(aria) == "More actions", "open": p.locator(".gf-pop[data-state=open]").count()}
        check("menu More actions: Tab closes it and goes on to the next control, Shift+Tab closes it back on its button",
              inside and not fwd["on button"] and not fwd["in menu"] and not fwd["now"].startswith("body") and fwd["open"] == 0 and bwd == {"on button": True, "open": 0},
              json.dumps({"tab": fwd, "shift+tab": bwd}))

        # The record header's More menu, and a drawer: Add finding on the move-out unit's Move-out tab.
        go(p, f"/tenancy/{mo}?tab=move-out")
        motion_still(p, "the Move-out tab, opened by its address")
        p.get_by_role("link", name="Overview", exact=True).first.click()
        motion_still(p, "Overview, after its tab is clicked")
        p.get_by_role("link", name="Move-out", exact=True).first.click()
        motion_still(p, "Move-out, after its tab is clicked")
        armed = p.locator("[data-trace=armed]").count()
        check("reduced motion: the inspection's boxes are drawn at once, none waiting for a moment to play", armed == 0, f"{armed} photo(s) armed")
        add = p.get_by_role("button", name="Add finding").first
        add.focus()
        p.keyboard.press("Enter")
        p.wait_for_timeout(150)
        dr = p.get_by_role("dialog")
        d_open = dr.count() >= 1 and in_("[role=dialog]")
        d_trap = True
        for _ in range(12):
            p.keyboard.press("Tab")
            d_trap = d_trap and in_("[role=dialog]")
        axe(p, shots, "drawer-add-finding", "1280")
        motion_still(p, "the Add finding drawer open")
        p.keyboard.press("Escape")
        p.wait_for_timeout(150)
        d_back = active().endswith('"Add finding"')
        check("drawer Add finding: focus moves in, Tab stays inside, Escape closes it and focus is back on Add finding",
              d_open and d_trap and d_back, json.dumps({"open": d_open, "trapped": d_trap, "back": d_back, "now": active()}))

        # The deductions grid: Tab reaches a cell, the arrow keys move, Enter edits an input, Escape cancels, focus stays.
        cell = p.locator(".gf-deductions .ag-cell").first
        cell.scroll_into_view_if_needed()
        cell.click()
        p.keyboard.press("Escape")
        before = active()
        p.keyboard.press("ArrowDown")
        p.keyboard.press("ArrowDown")
        moved = active() != before and in_(".gf-deductions")
        check("deductions grid: the arrow keys move between cells", moved, f"{before} -> {active()}")
        # A row's menu from its cell (the grid is one Tab stop): down to a charge, End to its Actions cell, Enter opens
        # the menu with focus inside, Escape gives focus back to the cell's button.
        for _ in range(6):
            if p.evaluate("() => !!document.activeElement.closest('.ag-row')?.querySelector('[col-id=menu] button')"):
                break
            p.keyboard.press("ArrowDown")
        p.keyboard.press("End")
        p.keyboard.press("Enter")
        p.wait_for_timeout(150)
        m_open = p.locator(".gf-pop[data-state=open]").count() == 1 and in_(".gf-pop")
        p.keyboard.press("Escape")
        p.wait_for_timeout(150)
        m_back = in_(".gf-deductions [col-id=menu]")
        check("deductions grid: Enter on a charge's Actions cell opens its menu (Edit, Remove) with focus inside, Escape gives focus back to the cell",
              m_open and m_back, json.dumps({"open": m_open, "back": m_back, "now": active()}))
        p.keyboard.press("Tab")
        p.wait_for_timeout(80)
        left = not in_(".gf-deductions .ag-root-wrapper")
        check("deductions grid: Tab leaves the grid (one stop; the arrow keys work inside)", left, active())

        # Payments: Tab into the grid, the arrow keys, Enter opens a row's details, Escape gives focus back to the row.
        go(p, "/ledger")
        p.locator(".ag-row").first.wait_for()
        # From the filter box, Tab into the grid (its first header), then down the rows with the arrow keys.
        p.get_by_placeholder("Filter rows").focus()
        for _ in range(12):
            p.keyboard.press("Tab")
            if in_(".ag-root-wrapper"):
                break
        p.keyboard.press("ArrowDown")
        p.keyboard.press("ArrowDown")
        p.wait_for_timeout(80)
        on_row = in_(".ag-row[row-index]")
        p.keyboard.press("Enter")
        p.wait_for_timeout(200)
        panel = p.get_by_role("dialog")
        opened = panel.count() >= 1 and in_("[role=dialog]")
        if opened:
            axe(p, shots, "ledger-details", "1280")
        p.keyboard.press("Escape")
        p.wait_for_timeout(200)
        back = in_(".ag-root-wrapper")
        check("Payments grid: Tab reaches it, the arrow keys reach a row, Enter opens its details with focus inside, Escape closes them and focus is back in the grid",
              on_row and opened and back, json.dumps({"row": on_row, "opened": opened, "back": back, "now": active()}))
        p.keyboard.press("End")
        p.keyboard.press("Enter")
        p.wait_for_timeout(150)
        m_open = p.locator(".gf-pop[data-state=open]").count() == 1 and in_(".gf-pop")
        p.keyboard.press("Escape")
        p.wait_for_timeout(150)
        check("Payments grid: Enter on a row's Actions cell opens its menu with focus inside, Escape gives focus back to the grid",
              m_open and in_(".ag-root-wrapper"), json.dumps({"open": m_open, "now": active()}))
        # From the row's menu button (where Escape left focus): Enter opens the menu again, Tab closes it back on the
        # button (the menu is drawn on the body, outside the page's order), and the arrow keys go on to the next row.
        row_of = "() => document.activeElement?.closest('.ag-row')?.getAttribute('row-index') ?? null"
        r0 = p.evaluate(row_of)
        p.keyboard.press("Enter")
        p.wait_for_timeout(150)
        again = p.locator(".gf-pop[data-state=open]").count() == 1 and in_(".gf-pop")
        p.keyboard.press("Tab")
        p.wait_for_timeout(150)
        on_cell = in_(".ag-root-wrapper [col-id=menu]") and p.locator(".gf-pop[data-state=open]").count() == 0
        # Up a row (down from the first): the arrow keys are the grid's there, not the menu button's.
        step = -1 if r0 is not None and int(r0) > 0 else 1
        p.keyboard.press("ArrowUp" if step < 0 else "ArrowDown")
        p.wait_for_timeout(120)
        r1 = p.evaluate(row_of)
        moved_row = r0 is not None and r1 is not None and int(r1) == int(r0) + step and p.locator(".gf-pop[data-state=open]").count() == 0
        check("Payments grid: Tab out of a row's menu closes it back on the row's button, and the arrow keys go on to the next row from there (they don't open the menu)",
              again and on_cell and moved_row, json.dumps({"reopened": again, "back on the cell": on_cell, "row": [r0, r1], "now": active()}))

        # With the grid one Tab stop, every control inside a cell is reached from its cell: Enter on the cell presses it
        # (a link opens its page, or the row's details carry it; a row's menu opens; an info tip opens; a group opens
        # or closes). One cell of each kind of row and column, in each grid.
        def press_cells(path, sel, name):
            go(p, path)
            p.locator(f"{sel} .ag-row").first.wait_for()
            p.mouse.move(0, 0)
            items = p.evaluate(GRID_CELLS, sel)
            bad, done = [], []
            for it in items:
                cell = p.locator(f"{sel} .ag-row[row-index='{it['row']}'] .ag-cell[col-id='{it['col']}']").first
                cell.scroll_into_view_if_needed()
                cell.focus()
                p.wait_for_timeout(60)
                before = p.evaluate(OPENED, [sel, it["row"], it["col"]])
                p.keyboard.press("Enter")
                after, what = before, None
                for _ in range(80):
                    p.wait_for_timeout(100)
                    after = p.evaluate(OPENED, [sel, it["row"], it["col"]])
                    what = (f"opens {after['url']}" if after["url"] != before["url"] else "opens a dialog" if after["dialog"] > before["dialog"]
                            else "opens its menu" if after["menu"] > before["menu"] else "opens its tip" if after["tip"] and not before["tip"]
                            else "opens or closes its group" if after["expanded"] != before["expanded"] else None)
                    if what:
                        break
                (done if what else bad).append(f"{it['key']} \"{it['name']}\"" + (f" {what}" if what else ": Enter did nothing"))
                # The page put back as it was.
                if after["url"] != before["url"]:
                    go(p, path)
                    p.locator(f"{sel} .ag-row").first.wait_for()
                elif after["expanded"] != before["expanded"]:
                    p.keyboard.press("Enter")
                    p.wait_for_timeout(200)
                elif what:
                    p.keyboard.press("Escape")
                    p.wait_for_timeout(200)
            check(f"grid, {name}: Enter on a cell presses the control in it ({'; '.join(done)})", bool(items) and not bad, "; ".join(bad) or "no cell with a control found")

        press_cells("/insights", ".gf-grid", "Insights")
        press_cells("/ledger", ".ag-root-wrapper", "Payments")
        press_cells(f"/tenancy/{mo}?tab=move-out", ".gf-deductions", "the move-out unit's deductions")

        # Check a lease, with its result: demo/lease-single-owner.pdf read by the stubbed lease job, judged by the code.
        for width in ("1280", "390"):
            lc = context(width)
            lp = open_page(lc)
            go(lp, "/lease")
            lp.locator("input[type=file]").set_input_files(str(REPO / "demo/lease-single-owner.pdf"))
            lp.get_by_role("heading", name="Findings").wait_for(timeout=60_000)
            lp.wait_for_timeout(300)
            axe(lp, shots, "lease-check-result", width)
            motion_still(lp, f"the lease check's result at {width} px")
            walk(lp, "lease-check-result", width)
            if width == "390":
                phone(lp, "lease-check-result", False)
            shot(lp, "lease-check-result", width)
            lc.close()

        # The statement's delivery dialog: opened, checked, then used (the tenants can dispute once it is out).
        go(p, f"/tenancy/{mo}/statement")
        rec = p.get_by_role("button", name="Record delivery").first
        rec.focus()
        p.keyboard.press("Enter")
        p.wait_for_timeout(200)
        dd = p.get_by_role("dialog")
        axe(p, shots, "dialog-record-delivery", "1280")
        dd_ok = dd.count() >= 1 and in_("[role=dialog]")
        p.keyboard.press("Escape")
        p.wait_for_timeout(150)
        check("Record delivery: focus moves into its dialog and Escape gives it back to the button", dd_ok and active().endswith('"Record delivery"'), active())
        rec.click()
        p.get_by_role("dialog").get_by_role("button", name="In person").click()
        p.get_by_role("dialog").get_by_role("button", name="Record delivery").click()
        p.get_by_text("Open the tenant's view").first.wait_for(timeout=30_000)

        # The prepared refund (the stubbed close-out agent), audited at both widths.
        go(p, f"/tenancy/{mo}/refund")
        p.get_by_role("button", name="Prepare refund").click()
        p.get_by_role("button", name="Send refund").wait_for(timeout=90_000)
        p.wait_for_timeout(300)
        axe(p, shots, "refund-prepared", "1280")
        motion_still(p, "the refund review after Prepare refund")
        walk(p, "refund-prepared", "1280")
        shot(p, "refund-prepared", "1280")
        ctx.close()

        # ---------- The tenants' pages on a phone: the dispute form, its errors, the advocate's case ----------
        ctx = context("390")
        p = open_page(ctx)
        go(p, f"/tenancy/{mo}/refund")
        axe(p, shots, "refund-prepared", "390")
        phone(p, "refund-prepared", False)
        shot(p, "refund-prepared", "390")

        # The phone navigation: a modal drawer.
        go(p, "/units")
        nav = p.get_by_role("button", name="Open navigation")
        nav.focus()
        p.keyboard.press("Enter")
        p.wait_for_timeout(150)
        n_in = in_("[aria-label=Navigation]")
        n_trap = True
        for _ in range(16):
            p.keyboard.press("Tab")
            n_trap = n_trap and in_("[aria-label=Navigation]")
        axe(p, shots, "phone-navigation", "390")
        motion_still(p, "the phone navigation open")
        p.keyboard.press("Escape")
        p.wait_for_timeout(150)
        n_back = active().endswith('"Open navigation"') or p.evaluate("() => document.activeElement?.getAttribute('aria-label') === 'Open navigation'")
        check("phone navigation: focus moves in, Tab stays inside, Escape closes it and focus is back on its button", n_in and n_trap and n_back,
              json.dumps({"in": n_in, "trapped": n_trap, "back": n_back}))

        go(p, tenant_mo)
        axe(p, shots, "tenants-page-delivered", "390")
        phone(p, "tenants-page-delivered", True)
        walk(p, "tenants-page-delivered", "390")
        shot(p, "tenants-page-delivered", "390")
        # A Why? tip by touch: a tap opens it, a second tap closes it, and it fits the screen.
        why = p.get_by_role("button", name="Why?").first
        why.scroll_into_view_if_needed()
        why.tap()
        p.wait_for_timeout(150)
        tb = p.locator("[role=tooltip]").first.bounding_box() if p.locator("[role=tooltip]").count() else None
        fits = bool(tb) and tb["x"] >= 0 and tb["x"] + tb["width"] <= 390
        why.tap()
        p.wait_for_timeout(150)
        check("390 px, tenants' page: a tap opens a Why? tip inside the screen and a second tap closes it", fits and p.locator("[role=tooltip]").count() == 0, json.dumps(tb))

        p.get_by_role("link", name="Dispute it").first.click()
        p.get_by_text("Which charges?").wait_for()
        p.wait_for_timeout(200)
        axe(p, shots, "tenants-dispute-form", "390")
        phone(p, "tenants-dispute-form", True)
        walk(p, "tenants-dispute-form", "390")
        shot(p, "tenants-dispute-form", "390")
        p.get_by_label("1. Bedroom carpet", exact=False).check()
        # A refused value (a charge ticked with no reasons): the error is an alert, and the field it names is
        # aria-invalid, described by it and focused (WCAG 3.3.1). Nothing is sent.
        p.get_by_role("button", name="Ask my advocate").click()
        p.wait_for_timeout(300)
        marked = p.evaluate("""() => {
          const a = document.activeElement;
          const alert = [...document.querySelectorAll('[role=alert]')].find((x) => /Say why/.test(x.innerText));
          const ids = (a && a.getAttribute('aria-describedby') || '').split(/\\s+/);
          return { focus: a ? a.tagName.toLowerCase() : null, invalid: a ? a.getAttribute('aria-invalid') : null, alert: alert ? alert.innerText : null, described: !!alert && !!alert.id && ids.includes(alert.id) };
        }""")
        check("390 px, tenants' dispute form: a refused value is read out (an alert), and the field it names is aria-invalid, described by it and focused",
              marked["focus"] == "textarea" and marked["invalid"] == "true" and marked["described"], json.dumps(marked))
        shot(p, "tenants-dispute-form-error", "390")
        p.get_by_placeholder("What's wrong with this charge, in your words").fill("The stain was one small spot, and nobody asked us about cleaning it first.")
        p.get_by_label("Your name").select_option(label="Priya Raman")
        p.get_by_role("button", name="Ask my advocate").click()
        p.get_by_role("region", name="Your advocate's case").wait_for(timeout=90_000)
        p.wait_for_timeout(300)
        axe(p, shots, "tenants-advocate-case", "390")
        phone(p, "tenants-advocate-case", True)
        motion_still(p, "the advocate's case, once it lands")
        walk(p, "tenants-advocate-case", "390")
        shot(p, "tenants-advocate-case", "390")
        ctx.close()

        ctx = context("1280")
        p = open_page(ctx)
        go(p, f"{tenant_mo}/dispute")
        axe(p, shots, "tenants-advocate-case", "1280")
        walk(p, "tenants-advocate-case", "1280")
        shot(p, "tenants-advocate-case", "1280")
        ctx.close()

        check("names: every info tip and Why? on the pages walked says what it explains, not only \"More information\" or \"Why?\"", not bare_tips, "; ".join(bare_tips[:10]))
        check("no page error on the way", not errors, "; ".join(errors[:6]))
        browser.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--worktree", type=Path, help="make a temporary worktree here, build it, serve it on --port, audit it, remove it")
    ap.add_argument("--serve", type=Path, help="serve this already-built directory on --port with the stubs on, audit it, stop it")
    ap.add_argument("--port", type=int, default=e2e.PORT)
    ap.add_argument("--base", help="audit a server already running with the stubs on (with --codes, or its secret and access code in the environment)")
    ap.add_argument("--codes", type=Path, help="with --base: the codes.json an e2e-demo.py --serve --hold server wrote")
    ap.add_argument("--shots", type=Path, help="where the screenshots, axe's reports and the server's log go (default: a new temporary folder)")
    a = ap.parse_args()

    def stopped(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stopped)

    if sum(bool(x) for x in (a.worktree, a.serve, a.base)) != 1:
        ap.error("pass exactly one of --worktree, --serve or --base")
    if a.worktree and a.worktree.exists():
        ap.error(f"{a.worktree} already exists: --worktree makes a new directory (and removes it afterwards)")
    if not AXE.exists():
        ap.error(f"{AXE} is missing: npm install (axe-core is a pinned devDependency)")
    shots = a.shots or Path(tempfile.mkdtemp(prefix="gf-a11y-"))
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
        if not check("the server says the e2e stubs are on, so no Claude or PayPal call can be real", stubbed, "refusing to audit a server without the stubs"):
            return 2
        env = {**os.environ, "GOOD_FAITH_SESSION_SECRET": codes["secret"], "GOOD_FAITH_ACCESS_CODE": codes["access"]}
        setup = e2e.helper("setup", env=env, root=root)
        print(f"copy: workspace {setup['ws']}, units {json.dumps(setup['units'])}", flush=True)
        audit(base, setup, shots)
    except Exception as ex:
        check("the run finished without an error", False, f"{type(ex).__name__}: {ex}")
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
        if notes:
            print(f"\nModerate and minor axe findings and small targets that pass on spacing ({len(notes)}), not part of the bar:")
            for n in notes:
                print(f"  {n}")
        print(f"\nscreenshots, axe's reports and the server's log: {shots}")
        print(f"{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
