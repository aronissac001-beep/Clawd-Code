// ===== icons.js : one drawn icon set (24-unit stroke icons) for resources, tabs, categories, specialists, hazards and controls =====
const ICONS = {
  // resources
  funds: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5l3.9 2.25v4.5L12 16.5l-3.9-2.25v-4.5z"/>',
  pop: '<circle cx="12" cy="7.8" r="3.3"/><path d="M5.2 20c.7-4 3.4-6.2 6.8-6.2s6.1 2.2 6.8 6.2"/>',
  power: '<path d="M13.2 2.8L5.8 13.4h5.4l-1 7.8 8-11h-5.5z"/>',
  water: '<path d="M12 3.2c3.4 4.3 5.8 7.4 5.8 10.6a5.8 5.8 0 01-11.6 0C6.2 10.6 8.6 7.5 12 3.2z"/><path d="M9.3 14.4a2.8 2.8 0 002.4 2.5"/>',
  oxygen: '<circle cx="9.6" cy="14" r="5.6"/><circle cx="17.4" cy="6.6" r="2.7"/><circle cx="18.6" cy="14.6" r="1.4"/>',
  food: '<path d="M12 21v-9"/><path d="M12 12.5c0-4.6 3.2-7.8 7.6-7.8 0 4.6-3.2 7.8-7.6 7.8z"/><path d="M12 16c0-3.4-2.6-5.8-6-5.8 0 3.4 2.6 5.8 6 5.8z"/>',
  metals: '<path d="M3.5 17.5l3-6.5h11l3 6.5z"/><path d="M7.5 11l2-4h5l2 4"/>',
  sinter: '<rect x="3.5" y="6" width="17" height="12.5" rx="1.5"/><path d="M3.5 12.2h17M10 6v6.2M14.2 12.2v6.3"/>',
  parts: '<circle cx="12" cy="12" r="2.8"/><path d="M12 3.4v2.8M12 17.8v2.8M3.4 12h2.8M17.8 12h2.8M5.9 5.9l2 2M16.1 16.1l2 2M5.9 18.1l2-2M16.1 7.9l2-2"/><circle cx="12" cy="12" r="6.2"/>',
  polymers: '<path d="M12 3.3l7.5 4.35v8.7L12 20.7l-7.5-4.35v-8.7z"/><path d="M12 8.2l3.3 1.9v3.8L12 15.8l-3.3-1.9v-3.8z"/>',
  electronics: '<rect x="7" y="7" width="10" height="10" rx="1.6"/><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/><path d="M10.2 12h3.6"/>',
  fuel: '<path d="M12 3c.9 3.4 5.2 5.4 5.2 10.2a5.2 5.2 0 01-10.4 0c0-2.4 1.3-4.1 2.5-5.4.4 2 1.4 2.8 2.4 2.8 0-2.6-.9-4.6.3-7.6z"/>',
  rare: '<path d="M12 3l6.3 6.2L12 21 5.7 9.2z"/><path d="M5.7 9.2h12.6M9.4 9.2L12 21l2.6-11.8"/>',
  crystals: '<path d="M8.6 21L5.6 12.6 8.6 3.4l3 9.2z"/><path d="M15.4 21l-2.6-6.4 2.6-7.2 2.6 7.2z"/><path d="M4 21h16"/>',
  rp: '<circle cx="12" cy="12" r="1.7" fill="currentColor"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-60 12 12)"/>',
  // bottom tabs
  build: '<path d="M4.2 19.8l8.3-8.3"/><path d="M13.8 4.2l6 6-2.9 2.9-6-6z"/><path d="M10.9 7.1l-2-2 2.4-1.8 2.5.9"/>',
  layers: '<path d="M12 3.8l9 5-9 5-9-5z"/><path d="M3 13.6l9 5 9-5"/>',
  people: '<circle cx="9" cy="8.4" r="3"/><path d="M3.4 19.5c.6-3.7 2.8-5.6 5.6-5.6s5 1.9 5.6 5.6"/><circle cx="16.6" cy="7.4" r="2.4"/><path d="M15.4 12.3c2.8-.4 4.8 1.4 5.3 4.6"/>',
  research: '<path d="M9 3.4h6M10.2 3.4v6L5.1 18a2 2 0 001.7 3h10.4a2 2 0 001.7-3l-5.1-8.6v-6"/><path d="M7.4 15h9.2"/>',
  rockets: '<path d="M12 2.8c3 2.1 4.4 5.4 4.4 9.2v4.2H7.6V12c0-3.8 1.4-7.1 4.4-9.2z"/><circle cx="12" cy="10" r="1.7"/><path d="M7.6 13.6l-2.6 3v2.5h2.6M16.4 13.6l2.6 3v2.5h-2.6M10.4 19.2l1.6 2.3 1.6-2.3"/>',
  log: '<rect x="5" y="3.6" width="14" height="16.8" rx="2"/><path d="M8.4 8.6h7.2M8.4 12.4h7.2M8.4 16.2h4.4"/>',
  goals: '<path d="M6 21V3.8"/><path d="M6 4.4h11.6l-2.6 4 2.6 4H6"/>',
  // controls
  menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
  advisor: '<path d="M9.2 17.6h5.6M10 20.8h4"/><path d="M12 3.2a6.1 6.1 0 00-3.6 11c.6.5 1 1.2 1 2v.4h5.2v-.4c0-.8.4-1.5 1-2A6.1 6.1 0 0012 3.2z"/>',
  pause: '<rect x="7" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.6l10.4 6.4L8 18.4z" fill="currentColor" stroke="none"/>',
  fast: '<path d="M4 6.2l8 5.8-8 5.8zM12 6.2l8 5.8-8 5.8z" fill="currentColor" stroke="none"/>',
  fastest: '<path d="M2.5 7l6 5-6 5zM8.6 7l6 5-6 5zM14.7 7l6 5-6 5z" fill="currentColor" stroke="none"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  back: '<path d="M14.8 5.5L8.3 12l6.5 6.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  moon: '<path d="M19.5 14.6A8 8 0 019.4 4.5a8 8 0 1010.1 10.1z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.6" cy="8.6" r="1.1" fill="currentColor"/><circle cx="15.4" cy="15.4" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>',
  pin: '<path d="M9 3.5h6l-1 5.5 3 3v2H7v-2l3-3z"/><path d="M12 14v6.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  home: '<path d="M4 11.5L12 4.5l8 7"/><path d="M6.5 9.8V20h11V9.8"/>',
  star: '<path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  decision: '<path d="M6 21V4"/><path d="M6 4.6c4-2.2 7.8 2.2 12 0v8c-4.2 2.2-8-2.2-12 0"/>',
  // services
  dining: '<path d="M4 12.5h16a8 8 0 01-16 0z"/><path d="M10 9c0-1.6 1.1-2.2 1.1-3.9M14 9c0-1.6 1.1-2.2 1.1-3.9"/>',
  social: '<path d="M6 4h12l-6 7.5z"/><path d="M12 11.5V19M8.6 20.5h6.8"/>',
  fitness: '<path d="M7 7.5v9M17 7.5v9M4 10v4M20 10v4M7 12h10"/>',
  tree: '<path d="M12 21v-4.5"/><path d="M12 3l6.2 8.4h-3l3.8 5.1H5l3.8-5.1h-3z"/>',
  shop: '<path d="M5 8.5h14l-1.1 12H6.1z"/><path d="M9 8.5V7a3 3 0 016 0v1.5"/>',
  book: '<path d="M4 5.6c3-1 5.6-.8 8 1.1 2.4-1.9 5-2.1 8-1.1v13c-3-1-5.6-.8-8 1.1-2.4-1.9-5-2.1-8-1.1z"/><path d="M12 6.7v13"/>',
  spa: '<path d="M3.5 16.5c2.1-1.6 4.2-1.6 6.3 0s4.2 1.6 6.3 0 2.9-1.1 4.4 0"/><path d="M8.5 12.2c0-2.1 1.6-2.7 1.6-4.8M13.4 12.2c0-2.1 1.6-2.7 1.6-4.8"/>',
  // alerts and hazards
  warn: '<path d="M12 3.8l9 15.7H3z"/><path d="M12 10v4.2"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  danger: '<path d="M8.3 3.5h7.4l5.3 5.3v6.4l-5.3 5.3H8.3L3 15.2V8.8z"/><path d="M12 8v5"/><circle cx="12" cy="16.2" r=".6" fill="currentColor"/>',
  dust: '<path d="M3 8.5h11a2.8 2.8 0 10-2.8-2.8"/><path d="M3 12.5h15a2.8 2.8 0 11-2.8 2.8"/><path d="M3 16.5h7"/>',
  meteor: '<circle cx="15.5" cy="15.5" r="4"/><path d="M12.6 12.6L4 4M15 10.8L9.5 5.3M10.8 15L5.3 9.5"/>',
  cold: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.6 4.8L12 7l2.4-2.2M9.6 19.2L12 17l2.4 2.2"/>',
  quake: '<path d="M2.5 12h3.5l2-5 3 10 3-12 2.5 7h5"/>',
  // building categories
  infra: '<path d="M4 20V10.5L12 5l8 5.5V20"/><path d="M9.5 20v-5.5h5V20"/>',
  life: '<path d="M12 3.2c3.4 4.3 5.8 7.4 5.8 10.6a5.8 5.8 0 01-11.6 0C6.2 10.6 8.6 7.5 12 3.2z"/>',
  industry: '<path d="M3.5 20V11l5 3v-3l5 3v-3l5 3V5h2v15z"/><path d="M7 17h2M11.5 17h2M16 17h2"/>',
  science: '<path d="M9 3.4h6M10.2 3.4v6L5.1 18a2 2 0 001.7 3h10.4a2 2 0 001.7-3l-5.1-8.6v-6"/>',
  domes: '<path d="M3.5 18.5a8.5 8.5 0 0117 0z"/><path d="M8.2 18.5a3.8 6.8 0 017.6 0M3 18.5h18"/>',
  lines: '<path d="M4 7h16M4 17h16"/><path d="M8 7v10M16 7v10"/>',
  mods: '<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>',
  // specialists
  none: '<circle cx="12" cy="12" r="5"/>',
  engineer: '<path d="M14.7 6.2a4 4 0 00-5.2 5.2L4 16.9 7.1 20l5.5-5.5a4 4 0 005.2-5.2l-2.5 2.5-2.6-.5-.5-2.6z"/>',
  scientist: '<circle cx="12" cy="12" r="1.7" fill="currentColor"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-60 12 12)"/>',
  botanist: '<path d="M12 21v-9"/><path d="M12 12.5c0-4.6 3.2-7.8 7.6-7.8 0 4.6-3.2 7.8-7.6 7.8z"/><path d="M12 16c0-3.4-2.6-5.8-6-5.8 0 3.4 2.6 5.8 6 5.8z"/>',
  medic: '<path d="M9.3 3.8h5.4v5.5h5.5v5.4h-5.5v5.5H9.3v-5.5H3.8V9.3h5.5z"/>',
  security: '<path d="M12 3.2l7.5 2.8v5.6c0 4.4-3.1 8-7.5 9.4-4.4-1.4-7.5-5-7.5-9.4V6z"/>',
  geologist: '<path d="M3 20l6.5-11 3.5 5.5 2.5-3.5L21 20z"/><path d="M9.5 9l1.8 2.9"/>',
};
// an <svg> element for an icon; cls adds sizing/colour classes
function ic(name, cls) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('aria-hidden', 'true'); el.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
  el.innerHTML = ICONS[name] || ICONS.none;
  return el;
}
// the icon to use for a resource key in the UI
const resIcon = k => ICONS[k] ? k : 'none';
// small value with its icon, e.g. a cost line
const icv = (k, v, cls) => h('span', { class: 'icv' + (cls ? ' ' + cls : '') }, ic(resIcon(k), 'res-' + k), h('span', { class: 'num' }, v));
const MOD_ICON = { quarters: 'home', apartments: 'home', suites: 'home', nursery: 'pop', canteen: 'dining', lounge: 'social', gym: 'fitness', arboretum: 'tree', market: 'shop', arcade: 'dice', clinic: 'medic', medcenter: 'medic', school: 'book', security: 'security', spa: 'spa', hydro: 'food', vfarm: 'food', labmod: 'rp', workshop: 'parts' };
const SEV_ICON = { bad: 'danger', warn: 'warn', info: 'advisor' };
const icvList = (obj, f, sep) => h('span', { class: 'row wrap', style: 'gap:4px 9px;justify-content:flex-end' }, ...Object.entries(obj).map(([k, v]) => icv(k, f ? f(v, k) : fmt(v))), sep || null);
const SVC_ICON = { dining: 'dining', fitness: 'fitness', social: 'social', relax: 'tree', shopping: 'shop', play: 'dice', medical: 'medic', education: 'book', safety: 'security' };
const svc = (w, txt) => h('span', { class: 'icv' }, ic(SVC_ICON[w] || 'none', 'res-oxygen'), txt);
const FIELD_ICON = { eng: 'build', robo: 'parts', phys: 'rp', bio: 'food', soc: 'people', bt: 'star' };
const HZ_ICON = { dust: 'dust', meteor: 'meteor', cold: 'cold', quake: 'quake' };
