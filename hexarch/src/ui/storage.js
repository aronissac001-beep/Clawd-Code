// ===== storage.js : settings and save slots (localStorage) =====
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { localStorage.setItem(k, v); },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
};
const Settings = {
  data: { grid: true, resources: true, anim: 'normal', quality: 'high', hand: 'right', confirmEnd: true, autoCycle: true, lastCfg: null },
  load() { try { Object.assign(this.data, JSON.parse(LS.get('hexarch.settings') || '{}')); } catch (e) { /* keep defaults */ } },
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; try { LS.set('hexarch.settings', JSON.stringify(this.data)); } catch (e) { /* storage unavailable */ } },
};
Settings.load();

const Saves = {
  AUTO: ['auto1', 'auto2', 'auto3'],
  MANUAL: ['m1', 'm2', 'm3', 'm4', 'm5'],
  key(s) { return 'hexarch.save.' + s; },
  meta(s) { try { return JSON.parse(LS.get(this.key(s) + '.meta')); } catch (e) { return null; } },
  read(s) { return LS.get(this.key(s)); },
  // returns null on success, or an error message
  write(s, G, pid) {
    try {
      const data = HX.serializeGame(G), P = G.players[pid];
      const meta = { turn: G.turn, civ: CIVS[P.civ].name, civKey: CIVS[P.civ].key, size: G.cfg.size, script: G.cfg.script,
        cities: G.cities.filter(c => c.owner === pid).length, date: Date.now(), seed: G.seed, bytes: data.length };
      LS.set(this.key(s), data); LS.set(this.key(s) + '.meta', JSON.stringify(meta));
      return null;
    } catch (e) {
      return /quota/i.test(String(e && (e.name + e.message))) ? 'Storage is full. Delete an old save and try again.' : 'Could not save: ' + (e && e.message || e);
    }
  },
  remove(s) { LS.del(this.key(s)); LS.del(this.key(s) + '.meta'); },
  pickAutoSlot() {
    let best = this.AUTO[0], bd = Infinity;
    for (const s of this.AUTO) { const m = this.meta(s); const d = m ? m.date : -1; if (d < bd) { bd = d; best = s; } }
    return best;
  },
  latest() {
    let best = null, bd = -1;
    for (const s of this.AUTO.concat(this.MANUAL)) { const m = this.meta(s); if (m && m.date > bd) { bd = m.date; best = s; } }
    return best;
  },
};
