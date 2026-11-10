// ===== storage.js : settings and save slots in localStorage (key prefix kessa.) =====
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
};
const Settings = {
  data: { sfx: true, music: true, vol: 0.7, tips: true, tipsDone: [], quality: 'auto', autosave: true, lastCfg: null, edgeLabels: true },
  load() { try { Object.assign(this.data, JSON.parse(LS.get('kessa.settings') || '{}')); } catch (e) { /* defaults */ } },
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; LS.set('kessa.settings', JSON.stringify(this.data)); },
};
Settings.load();
const Saves = {
  SLOTS: ['auto', 'm1', 'm2', 'm3', 'm4', 'm5'],
  key(s) { return 'kessa.save.' + s; },
  meta(s) { try { return JSON.parse(LS.get(this.key(s) + '.meta')); } catch (e) { return null; } },
  read(s) { return LS.get(this.key(s)); },
  write(s, G) {
    try {
      const data = KC.serialize(G);
      const meta = { sol: KC.solOf(G.tick), pop: G.colonists.length, sponsor: SPONSORS[G.cfg.sponsor].name, diff: DIFFICULTY[G.cfg.difficulty].name, date: Date.now(), seed: G.seed, kb: Math.round(data.length / 1024) };
      if (!LS.set(this.key(s), data)) return 'Storage is full or unavailable. Delete an old save or export as text.';
      LS.set(this.key(s) + '.meta', JSON.stringify(meta));
      return null;
    } catch (e) { return 'Could not save: ' + (e && e.message || e); }
  },
  load(s) { const d = this.read(s); if (!d) return null; return KC.deserialize(d); },
  remove(s) { LS.del(this.key(s)); LS.del(this.key(s) + '.meta'); },
  latest() { let best = null; for (const s of this.SLOTS) { const m = this.meta(s); if (m && (!best || m.date > best.m.date)) best = { s, m }; } return best; },
};
