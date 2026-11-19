// ===== icons.js : the drawn UI icon set =====
// 24x24 inline SVG icons with the same dark ink outline as the map art. iconize() swaps the yield and
// HUD emoji in any DOM text for these icons (keeping the emoji as visually hidden text for screen
// readers), and a MutationObserver keeps every screen, dialog and panel converted as it renders.
const ICO_INK = '#10141a';
const ICO = {
  gold: `<circle cx="12" cy="12" r="8.6" fill="#f2c84b" stroke="${ICO_INK}" stroke-width="1.6"/><circle cx="12" cy="12" r="5.4" fill="none" stroke="#b8892f" stroke-width="1.5"/><path d="M8.6 8.4a5 5 0 0 1 4-1.7" stroke="#fff6cc" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  science: `<path d="M9.5 3.2h5M10.4 3.2v6.1L5 18.6a1.6 1.6 0 0 0 1.4 2.4h11.2a1.6 1.6 0 0 0 1.4-2.4l-5.4-9.3V3.2" fill="#cfeaf6" stroke="${ICO_INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.2 15h9.6l2 3.6a1 1 0 0 1-.9 1.5H6.1a1 1 0 0 1-.9-1.5z" fill="#5fd0a0"/><circle cx="13" cy="12.4" r="1" fill="#5fd0a0"/>`,
  food: `<path d="M12 21.5V8" stroke="${ICO_INK}" stroke-width="3.2" stroke-linecap="round"/><path d="M12 21.5V8" stroke="#c9a03a" stroke-width="1.4" stroke-linecap="round"/>` +
    [[9.2, 8.5, -35], [14.8, 8.5, 35], [9.2, 12.2, -35], [14.8, 12.2, 35], [9.2, 15.9, -35], [14.8, 15.9, 35], [12, 4.6, 0]].map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="1.9" ry="3" transform="rotate(${a} ${x} ${y})" fill="#f2cf5a" stroke="${ICO_INK}" stroke-width="1.3"/>`).join(''),
  prod: (() => { let d = ''; for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8 + Math.PI / 16, r = i % 2 ? 6.6 : 9.4; d += (i ? 'L' : 'M') + (12 + Math.cos(a) * r).toFixed(2) + ' ' + (12 + Math.sin(a) * r).toFixed(2); }
    return `<path d="${d}Z" fill="#f0a050" stroke="${ICO_INK}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" fill="#3a2414" stroke="${ICO_INK}" stroke-width="1"/>`; })(),
  culture: `<path d="M4 4.5c5 1.6 11 1.6 16 0v6.8c0 5-3.6 9-8 9.7-4.4-.7-8-4.7-8-9.7z" fill="#d99af0" stroke="${ICO_INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 9.6q1.6-1.4 3.2 0M13.8 9.6q1.6-1.4 3.2 0" stroke="${ICO_INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M8.6 14.4q3.4 3 6.8 0" stroke="${ICO_INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  faith: `<g stroke="#f6d77a" stroke-width="1.6" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => { const r = a * Math.PI / 180; return `<path d="M${(12 + Math.cos(r) * 6.4).toFixed(1)} ${(12 + Math.sin(r) * 6.4).toFixed(1)}L${(12 + Math.cos(r) * 9.6).toFixed(1)} ${(12 + Math.sin(r) * 9.6).toFixed(1)}"/>`; }).join('')}</g><circle cx="12" cy="12" r="4.6" fill="#fff1c2" stroke="${ICO_INK}" stroke-width="1.5"/>`,
  citizens: `<circle cx="8.4" cy="8.4" r="3" fill="#9ac4f0" stroke="${ICO_INK}" stroke-width="1.4"/><path d="M3 19.5a5.4 5.4 0 0 1 10.8 0z" fill="#9ac4f0" stroke="${ICO_INK}" stroke-width="1.4" stroke-linejoin="round"/><circle cx="15.8" cy="7.4" r="3" fill="#cfe2f6" stroke="${ICO_INK}" stroke-width="1.4"/><path d="M11 18.5a5.4 5.4 0 0 1 10.6-1v2z" fill="#cfe2f6" stroke="${ICO_INK}" stroke-width="1.4" stroke-linejoin="round"/>`,
  happy: `<circle cx="12" cy="12" r="8.6" fill="#f2d264" stroke="${ICO_INK}" stroke-width="1.6"/><circle cx="9" cy="10" r="1.2" fill="${ICO_INK}"/><circle cx="15" cy="10" r="1.2" fill="${ICO_INK}"/><path d="M8.2 14q3.8 3.6 7.6 0" stroke="${ICO_INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  unhappy: `<circle cx="12" cy="12" r="8.6" fill="#f0a050" stroke="${ICO_INK}" stroke-width="1.6"/><circle cx="9" cy="10" r="1.2" fill="${ICO_INK}"/><circle cx="15" cy="10" r="1.2" fill="${ICO_INK}"/><path d="M8.6 16.4q3.4-2.6 6.8 0" stroke="${ICO_INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  angry: `<circle cx="12" cy="12" r="8.6" fill="#ec6a5f" stroke="${ICO_INK}" stroke-width="1.6"/><path d="M7.4 8.4l3 1.4M16.6 8.4l-3 1.4" stroke="${ICO_INK}" stroke-width="1.6" stroke-linecap="round"/><circle cx="9.2" cy="11" r="1.1" fill="${ICO_INK}"/><circle cx="14.8" cy="11" r="1.1" fill="${ICO_INK}"/><path d="M8.6 16.6q3.4-2.6 6.8 0" stroke="${ICO_INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  golden: `<path d="M12 2.5l2.2 6.2 6.3 2.3-6.3 2.3L12 19.5l-2.2-6.2L3.5 11l6.3-2.3z" fill="#ffe08a" stroke="${ICO_INK}" stroke-width="1.4" stroke-linejoin="round"/><path d="M18.5 15.5l.9 2.3 2.1.8-2.1.8-.9 2.3-.9-2.3-2.1-.8 2.1-.8z" fill="#fff4c8" stroke="${ICO_INK}" stroke-width="1" stroke-linejoin="round"/>`,
  map: `<path d="M3 6l6-2.4 6 2.4 6-2.4v14.4l-6 2.4-6-2.4-6 2.4z" fill="#9ccf7a" stroke="${ICO_INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 3.6v14.4M15 6v14.4" stroke="${ICO_INK}" stroke-width="1.4"/><path d="M15 6l6-2.4v14.4l-6 2.4z" fill="#6aa8d8" stroke="${ICO_INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M4.6 10.6q2 1.4 3 -1" stroke="#4a7a3a" stroke-width="1.2" fill="none"/>`,
  lens: `<path d="M2 12s3.8-6.6 10-6.6S22 12 22 12s-3.8 6.6-10 6.6S2 12 2 12z" fill="#eef3f8" stroke="${ICO_INK}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="4" fill="#7fb4ff" stroke="${ICO_INK}" stroke-width="1.4"/><circle cx="12" cy="12" r="1.7" fill="${ICO_INK}"/><circle cx="13.4" cy="10.6" r=".9" fill="#fff"/>`,
  policy: `<path d="M4 7.6L12 3l8 4.6z" fill="#e8dcc0" stroke="${ICO_INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 8.4h14M5 18.6h14M3.6 20.8h16.8" stroke="${ICO_INK}" stroke-width="1.5" stroke-linecap="round"/>${[7, 10.4, 13.6, 17].map(x => `<rect x="${x - 1}" y="9" width="2" height="9" fill="#e8dcc0" stroke="${ICO_INK}" stroke-width="1.2"/>`).join('')}`,
  diplomacy: `<path d="M5 19.5C7 13 11 8 19 4.5" stroke="${ICO_INK}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M5 19.5C7 13 11 8 19 4.5" stroke="#8a6a3a" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
    [[8.6, 13.4, -60], [7.2, 16.2, 30], [11.6, 9.8, -50], [11, 13.2, 40], [15.2, 7, -40], [14.8, 9.8, 50], [18.6, 4.6, -20]].map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="1.6" ry="2.9" transform="rotate(${a} ${x} ${y})" fill="#8fd38a" stroke="${ICO_INK}" stroke-width="1.2"/>`).join(''),
  victory: `<path d="M7 3.6h10v4.8a5 5 0 0 1-10 0z" fill="#f2c84b" stroke="${ICO_INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 5.4H4.2v1.4A3.4 3.4 0 0 0 7.4 10.4M17 5.4h2.8v1.4a3.4 3.4 0 0 1-3.2 3.6" stroke="${ICO_INK}" stroke-width="1.5" fill="none"/><path d="M10.6 13.2h2.8v3.4h-2.8z" fill="#c9a03a" stroke="${ICO_INK}" stroke-width="1.3"/><path d="M7.6 20.6h8.8l-1-3.8H8.6z" fill="#b8892f" stroke="${ICO_INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 5.6v2.6" stroke="#fff6cc" stroke-width="1.3" stroke-linecap="round"/>`,
  quest: `<path d="M6.4 4h11.2a2 2 0 0 1 0 4H17v10.6a2 2 0 0 1-2 2H6a2 2 0 0 1 0-4h.4z" fill="#ead9b0" stroke="${ICO_INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.6 9h4.6M9.6 12h4.6M9.6 15h3" stroke="#8a6a3a" stroke-width="1.3" stroke-linecap="round"/><circle cx="15.6" cy="17.6" r="2.4" fill="#c84a3a" stroke="${ICO_INK}" stroke-width="1.2"/>`,
  swords: `<path d="M4 4l11 11M20 4L9 15" stroke="${ICO_INK}" stroke-width="4.2" stroke-linecap="round"/><path d="M4 4l11 11M20 4L9 15" stroke="#dfe4ea" stroke-width="2" stroke-linecap="round"/><path d="M12.6 17.8l5.2-5.2M6.2 12.6l5.2 5.2" stroke="${ICO_INK}" stroke-width="4" stroke-linecap="round"/><path d="M12.6 17.8l5.2-5.2M6.2 12.6l5.2 5.2" stroke="#c9a03a" stroke-width="2" stroke-linecap="round"/><path d="M16.4 16.4l3.4 3.4M7.6 16.4l-3.4 3.4" stroke="${ICO_INK}" stroke-width="3.2" stroke-linecap="round"/><path d="M16.4 16.4l3.4 3.4M7.6 16.4l-3.4 3.4" stroke="#8a5a30" stroke-width="1.4" stroke-linecap="round"/>`,
  rocket: `<path d="M12 2.6c3.4 2.6 4.6 6.6 4.2 11.4H7.8C7.4 9.2 8.6 5.2 12 2.6z" fill="#eef2f6" stroke="${ICO_INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M7.8 11.6L4.6 16.4l3.4-.4M16.2 11.6l3.2 4.8-3.4-.4" fill="#ec6a5f" stroke="${ICO_INK}" stroke-width="1.4" stroke-linejoin="round"/><circle cx="12" cy="8.6" r="1.9" fill="#7fb4ff" stroke="${ICO_INK}" stroke-width="1.2"/><path d="M10 14.6c0 2.6 1 4.6 2 6.6 1-2 2-4 2-6.6z" fill="#ffb04a" stroke="${ICO_INK}" stroke-width="1.2" stroke-linejoin="round"/>`,
  medal: `<path d="M8 2.8h3l1 6h-3zM16 2.8h-3l-1 6h3z" fill="#5b84dc" stroke="${ICO_INK}" stroke-width="1.3" stroke-linejoin="round"/><circle cx="12" cy="14.6" r="6" fill="#f2c84b" stroke="${ICO_INK}" stroke-width="1.6"/><path d="M12 11.2l1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z" fill="#fff4c8" stroke="#b8892f" stroke-width=".8" stroke-linejoin="round"/>`,
  heart: `<path d="M12 20.4S3.2 15 3.2 9a4.4 4.4 0 0 1 8.8-1.4A4.4 4.4 0 0 1 20.8 9c0 6-8.8 11.4-8.8 11.4z" fill="#ec6a5f" stroke="${ICO_INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 8.2a2 2 0 0 1 2-1.6" stroke="#ffc4bc" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  menu: `<path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  back: `<path d="M14.6 5.4L8 12l6.6 6.6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
};
// The icon as an element: <i class="ico ico-NAME"><svg/>(hidden label)</i>
function ico(name, label) {
  const i = document.createElement('i'); i.className = 'ico ico-' + name; i.setAttribute('aria-hidden', label ? 'false' : 'true');
  i.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICO[name]}</svg>`;
  if (label) { const s = document.createElement('span'); s.className = 'vh'; s.textContent = label; i.appendChild(s); }
  return i;
}
const EMOJI_ICON = { '💰': 'gold', '🔬': 'science', '🌾': 'food', '⚙': 'prod', '🎭': 'culture', '🙏': 'faith', '👥': 'citizens', '🙂': 'happy', '😟': 'unhappy', '😡': 'angry', '✨': 'golden', '🗺': 'map', '👁': 'lens', '🤝': 'diplomacy', '🏆': 'victory', '📜': 'quest', '⚔': 'swords', '🚀': 'rocket', '🏅': 'medal', '🕊': 'diplomacy', '❤': 'heart' };
const EMOJI_RE = /(💰|🔬|🌾|⚙|🎭|🙏|👥|🙂|😟|😡|✨|🗺|👁|🤝|🏆|📜|⚔|🚀|🏅|🕊|❤)️?/u;
const WHOLE_ICON = { '☰': 'menu', '‹': 'back', '✕': 'close' };
function iconize(root) {
  if (!root || root.nodeType === 3 && !root.parentNode) return;
  const walker = document.createTreeWalker(root.nodeType === 3 ? root.parentNode : root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => { const p = n.parentNode; if (!p || p.closest && p.closest('.ico,textarea,option,select,script,style,canvas,.noico')) return NodeFilter.FILTER_REJECT; return EMOJI_RE.test(n.data) || WHOLE_ICON[n.data.trim()] ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; } });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const whole = WHOLE_ICON[n.data.trim()];
    if (whole) { n.parentNode.replaceChild(ico(whole, n.data.trim()), n); continue; }
    const frag = document.createDocumentFragment(); let rest = n.data, m;
    while ((m = rest.match(EMOJI_RE))) {
      if (m.index) frag.appendChild(document.createTextNode(rest.slice(0, m.index)));
      frag.appendChild(ico(EMOJI_ICON[m[1]], m[0]));
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) frag.appendChild(document.createTextNode(rest));
    n.parentNode.replaceChild(frag, n);
  }
}
function watchIcons(root) {
  iconize(root);
  new MutationObserver(list => { for (const r of list) { if (r.type === 'characterData') iconize(r.target); else for (const n of r.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) iconize(n); } })
    .observe(root, { childList: true, subtree: true, characterData: true });
}

// A wonder's drawn landmark as a small portrait canvas for lists (falls back to its emoji).
function wonderPortrait(key, px) {
  if (!WONDER_ART[key]) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1), c = document.createElement('canvas'); px = px || 34;
  c.width = c.height = Math.round(px * dpr); c.style.width = c.style.height = px + 'px'; c.className = 'portrait';
  const x = c.getContext('2d'); x.translate(c.width / 2, c.height * 0.84); x.lineJoin = 'round'; x.lineCap = 'round';
  paintWonder(x, key, c.width * 0.36);
  return c;
}
