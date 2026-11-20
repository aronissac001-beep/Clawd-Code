// ===== palette.js : the one colour palette for Kessa (map, terrain, buildings, sprites, world map, UI accents) =====
// Value plan: the ground sits in the dark-middle values (rust and ochre), buildings in the light values (bone hulls, pale
// steel) with saturated accents (signal orange, teal) and dark recesses, so the colony reads at every zoom. Shadows are
// cool (violet-blue), lights are warm. Everything that glows uses the emissive group.
const PAL = {
  // ground by terrain type: dust plains, rock field, basalt, frost flats, dunes, highland
  terr: ['#a46a48', '#7f5543', '#4b3d3c', '#c4d2db', '#bf8957', '#8a6656'],
  // the far side of the light: shadowed ground leans violet, lit ground leans warm
  shadeTint: [0.86, 0.9, 1.08], litTint: [1.06, 1.0, 0.92],
  skirt: ['#6c4a38', '#523829', '#20160f'],
  grain: { dark: '38,22,16', light: '255,232,204' },
  boulder: { basalt: '#3a3234', highland: '#74584a', rock: '#5a4438' },
  frost: { lit: '240,248,255', edge: '120,160,196' },
  // Reshaping Kessa: wet ground once frost melts, lichen, moss, shrubs
  wet: [104, 80, 66], veg: [[184, 166, 74], [98, 136, 62], [58, 108, 54]], shrub: ['#4e7a3a', '#3f6a32', '#5f8a40'],
  water: { deep: '#123f5c', mid: '#246a8a', shallow: '#4fa0b4', foam: '235,246,244', wetSand: '78,54,40', sky: '170,210,236', glint: '240,250,255' },
  // atmosphere: void colour by grade (top, bottom) and the colour grade of the whole scene
  sky: {
    day: ['#4a3226', '#1c130e'], dusk: ['#5a2c2e', '#1d1012'], night: ['#0b0c18', '#05050a'], storm: ['#5a3a22', '#2a1a10'],
    stars: '255,248,236', veilAmber: [214, 150, 100], veilBlue: [120, 178, 232]
  },
  // multiply grades: [top rgb, bottom rgb]; screen haze: [rgb, alpha] at the top of the view (aerial perspective)
  grade: {
    day: { mul: [[246, 244, 250], [255, 250, 240]], haze: ['255,214,170', 0.10], light: '255,246,230' },
    dusk: { mul: [[214, 130, 140], [240, 162, 112]], haze: ['255,140,90', 0.16], light: '255,170,110' },
    night: { mul: [[48, 58, 108], [62, 70, 118]], haze: ['80,110,190', 0.06], light: '140,160,230' },
    storm: { mul: [[214, 156, 104], [196, 136, 92]], haze: ['200,140,84', 0.3], light: '255,200,140' },
    cold: { mul: [[196, 222, 250], [214, 232, 252]], haze: ['200,232,255', 0.14], light: '220,240,255' }
  },
  shadow: '28,16,32', // cast shadows: cool, slightly violet
  ao: '20,12,10',
  // building materials
  mat: {
    hull: '#e4d8c6', hull2: '#bfa991', panel: '#d0c3ae', steel: '#a2adb5', steel2: '#6c767e', dark: '#463f3d', iron: '#35302f',
    orange: '#ee8636', teal: '#3db3ad', glass: '#8cd2ea', solar: '#16294a', solarHi: '#33598c', copper: '#c98a4c', pad: '#6a5e58',
    violet: '#b48cff', pink: '#ff7ad9', concrete: '#8a7f78'
  },
  // light and emissive colours (all drawn additively at night)
  emit: { window: '255,206,128', windowHot: '255,232,180', lamp: '255,184,104', lampOuter: '255,140,60', beacon: '255,78,56', cyan: '96,226,255', green: '125,255,138', head: '255,244,214', thruster: '255,170,90', dome: '255,212,150' },
  // UI accents (mirrored as CSS custom properties at load, so the HUD and the map speak the same colours)
  ui: { amber: '#f2a65a', amber2: '#ffc68a', frost: '#8fd6f5', good: '#8fdc8a', warn: '#f5c76a', bad: '#ff8070', s0: '#0d0b0b', s1: '#17120f' },
  // world map relief by altitude band, sea, frost and green
  world: { low: [92, 58, 44], plain: [150, 96, 66], mid: [178, 122, 82], high: [200, 154, 110], peak: [222, 196, 166], seaDeep: [26, 66, 98], seaShallow: [52, 110, 134], ice: [228, 236, 244], green: [80, 126, 62] }
};
// a palette colour as 'r,g,b' or rgba()
const rgbOf = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgba = (rgb, a) => 'rgba(' + rgb + ',' + a + ')';
// the scene grade for this moment: blends day, dusk, night, storm and cold by weights, returns multiply stops, haze and light
function sceneGrade(sun, dust, cold) {
  const G0 = PAL.grade, dusk = sun > 0 && sun < 0.4 ? Math.sin(clamp(sun / 0.4, 0, 1) * Math.PI) * (sun < 0.2 ? 1 : 1) : 0;
  const night = 1 - clamp(sun / 0.16, 0, 1), day = clamp(1 - night - dusk * 0.85, 0, 1);
  let w = [['day', day], ['dusk', dusk * (1 - night * 0.5)], ['night', night]];
  const tot = w.reduce((a, b) => a + b[1], 0) || 1; w = w.map(([k, v]) => [k, v / tot]);
  const mix = (sel) => { const o = [0, 0, 0]; for (const [k, v] of w) { const c = sel(G0[k]); o[0] += c[0] * v; o[1] += c[1] * v; o[2] += c[2] * v; } return o; };
  let top = mix(g => g.mul[0]), bot = mix(g => g.mul[1]);
  let haze = mix(g => g.haze[0].split(',').map(Number)), hazeA = w.reduce((a, [k, v]) => a + G0[k].haze[1] * v, 0);
  const over = (g, k) => { if (k <= 0) return; const m = (a, b) => a.map((x, i) => x + (b[i] - x) * k); top = m(top, g.mul[0].map((x, i) => x * (night > 0.5 ? 0.45 : 1))); bot = m(bot, g.mul[1].map((x, i) => x * (night > 0.5 ? 0.45 : 1))); haze = m(haze, g.haze[0].split(',').map(Number)); hazeA += (g.haze[1] - hazeA) * k; };
  over(G0.storm, clamp(dust, 0, 1) * 0.85); over(G0.cold, cold ? 0.55 : 0);
  return { top, bot, haze, hazeA, night, dusk, day };
}
// mirror the accents into the stylesheet so HUD and map share one source of colour
if (typeof document !== 'undefined' && document.documentElement) { const st = document.documentElement.style; for (const [k, v] of [['--amber', PAL.ui.amber], ['--amber2', PAL.ui.amber2], ['--frost', PAL.ui.frost], ['--good', PAL.ui.good], ['--warn', PAL.ui.warn], ['--bad', PAL.ui.bad]]) st.setProperty(k, v); }
