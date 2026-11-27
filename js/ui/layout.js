// Phone layout (owner I; doc 10.1). The budgets in pt come from balance.js LAYOUT (G; S5 confirms
// them on a device). The CSS (css/style.css) draws the shell from the same numbers through custom
// properties set here, so a LAYOUT change moves both. Everything here is read-only and headless-safe.
import { LAYOUT } from '../data/balance.js';

/** Sizes in pt (CSS px). Doc 10.1 values; LAYOUT overrides the shared ones. */
export const SIZES = Object.freeze({
  topBar: LAYOUT.topBar ?? 44,
  rail: LAYOUT.rail ?? 52,
  portrait: 44,
  bottomBar: LAYOUT.bottomBar ?? 56,
  speed: 56,
  tab: 72,
  peek: LAYOUT.peek ?? 120,
  sheet: 0.75, sheetMax: 0.92,  // Stage 1 sheet heights (kept for old callers)
  detentMid: 0.5,               // W1.2 (8.1, 8.9 --detent-mid): the medium detent, a share of the height
  sheetLand: 0.48,              // W1.2 (G22, 8.9 --sheet-w-land): landscape sheets, a share of the width, full height
  keepMargin: 48,               // W1.2: the selection stays at least this far inside the uncovered world
  landscapePanel: LAYOUT.landscapePanel ?? 320,
  sideRail: 56,                 // landscape: the bottom bar becomes a vertical rail on the right
  alert: 44, alertsVisible: 4,
  gutter: 16,
  minTarget: LAYOUT.minTarget ?? 44,
  minTextPx: LAYOUT.minTextPx ?? 14,
  worldMin: LAYOUT.worldMin ?? 480, worldMinPeek: LAYOUT.worldMinPeek ?? 400,
  narrowClock: 380,             // below this width the season name becomes a 20 pt glyph
  loupe: 120, loupeLift: 80, loupeZoom: 2,
  holdMs: 250, longPressMs: 450, fan: 48,
});

/** Landscape when wider than tall and short (a phone on its side); tablets keep portrait chrome. */
export const isLandscape = (w, h) => w > h && h < 500;

/**
 * Safe-area insets in pt. On a device these come from env(safe-area-inset-*) (read through the
 * --sa-* probe in the CSS). `?debug=1&safe=t,r,b,l` emulates them (Playwright cannot), and the
 * CSS reads the same --sa-* properties, so the layout and these numbers always agree.
 */
export function safeInsets(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return { t: 0, r: 0, b: 0, l: 0 };
  const cs = getComputedStyle(doc.documentElement);
  const v = (k) => parseFloat(cs.getPropertyValue(k)) || 0;
  return { t: v('--sa-t'), r: v('--sa-r'), b: v('--sa-b'), l: v('--sa-l') };
}
/** Apply emulated insets from `?safe=t,r,b,l` (debug only). */
export function emulateInsets(params, doc = document) {
  const q = params.get('safe');
  if (!q) return false;
  const [t, r, b, l] = q.split(',').map((x) => Math.max(0, +x || 0));
  const st = doc.documentElement.style;
  st.setProperty('--sa-t', t + 'px'); st.setProperty('--sa-r', (r || 0) + 'px');
  st.setProperty('--sa-b', (b || 0) + 'px'); st.setProperty('--sa-l', (l ?? r ?? 0) + 'px');
  return true;
}

/**
 * The planned world rect for a viewport (pt), as 10.1 budgets it: nothing selected (rail shown) and
 * with a peek card (rail hidden). Landscape: the canvas never resizes; the card is a 320 pt overlay.
 */
export function plannedWorld(w, h, ins = { t: 0, r: 0, b: 0, l: 0 }) {
  const S = SIZES;
  if (isLandscape(w, h)) {
    const top = ins.t + S.topBar, right = ins.r + S.sideRail;
    const height = h - top - ins.b, width = w - ins.l - right;
    return { landscape: true, width, height, heightPeek: height, widthPeek: width - S.landscapePanel };
  }
  const height = h - ins.t - S.topBar - S.rail - S.bottomBar - ins.b;
  return { landscape: false, width: w - ins.l - ins.r, height, heightPeek: height + S.rail - S.peek, widthPeek: w - ins.l - ins.r };
}

/**
 * The measured world rect: the part of the canvas no chrome covers (CSS px). Reads the live DOM:
 * the canvas rect minus the rail, the peek card or panel and any open sheet.
 */
export function measureWorld(doc = document) {
  const q = (sel) => { const e = doc.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return null; const r = e.getBoundingClientRect(); return r.width && r.height ? r : null; };
  const cv = q('#view');
  if (!cv) return null;
  let top = cv.top, bottom = cv.bottom, left = cv.left, right = cv.right;
  const land = doc.body.classList.contains('land');
  const rail = q('.ec-rail');
  if (rail && !land) top = Math.max(top, rail.bottom);
  for (const sel of ['.ec-peek', '.ec-panel', '.ec-sheet']) {
    const r = q(sel);
    if (!r) continue;
    if (land && r.left > cv.left + 20) right = Math.min(right, r.left);
    else bottom = Math.min(bottom, r.top);
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * The planned sheet rect (CSS px) for a viewport (W1.2, G21, G22): portrait medium is the bottom
 * detentMid of the height, large reaches up to the top bar; landscape is sheetLand of the width (plus the
 * right inset) at full height, over the side rail.
 */
export function plannedSheet(w, h, ins = { t: 0, r: 0, b: 0, l: 0 }, detent = 'medium') {
  const S = SIZES;
  if (isLandscape(w, h)) { const width = w * S.sheetLand + ins.r; return { side: 'right', x: w - width, y: 0, width, height: h }; }
  const y = detent === 'large' ? ins.t + S.topBar : h * (1 - S.detentMid);
  return { side: 'bottom', x: 0, y, width: w, height: h - y };
}
/** How much of the canvas rect a sheet rect covers: { side: 'bottom' | 'right' | null, px }. */
export function sheetCover(sheet, canvas, land) {
  if (!sheet || !canvas || !(sheet.width > 0 && sheet.height > 0)) return { side: null, px: 0 };
  if (land) return { side: 'right', px: Math.max(0, Math.min(canvas.width, canvas.right - sheet.left)) };
  return { side: 'bottom', px: Math.max(0, Math.min(canvas.height, canvas.bottom - sheet.top)) };
}
/**
 * The camera centre (world units) that brings world point (wx, wy) to the middle of the part of the canvas
 * the sheet leaves uncovered, or null when the point is already at least `margin` inside it. cam: the
 * engine camera (worldToScreen in canvas px, x, y, zoom, vw, vh). Pure: the caller moves the camera.
 */
export function keepVisible(cam, wx, wy, cover, margin = SIZES.keepMargin) {
  const p = cam.worldToScreen(wx, wy);
  let r = cam.vw, b = cam.vh;
  if (cover && cover.side === 'right') r -= cover.px;
  else if (cover && cover.side === 'bottom') b -= cover.px;
  const m = Math.max(0, Math.min(margin, r / 4, b / 4));
  if (p.x >= m && p.x <= r - m && p.y >= m && p.y <= b - m) return null;
  return { x: cam.x + (p.x - r / 2) / cam.zoom, y: cam.y + (p.y - b / 2) / cam.zoom };
}
/**
 * The camera centre that puts world point (wx, wy) in the middle of the uncovered part of the view (for a
 * camera without C's setInset; with it, Camera.centerOn does this itself).
 */
export function centreFor(cam, wx, wy, cover) {
  const px = cover && cover.px > 0 ? cover.px / 2 / cam.zoom : 0;
  return { x: wx + (cover && cover.side === 'right' ? px : 0), y: wy + (cover && cover.side === 'bottom' ? px : 0) };
}
