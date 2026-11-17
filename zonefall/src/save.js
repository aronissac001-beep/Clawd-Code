// ZONEFALL 3 — persistence (localStorage)
export const Save = {
  KEY: 'zonefall_run_v3', META: 'zonefall_meta_v1', SET: 'zonefall_settings_v3',
  load() { try { return JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { return null; } },
  has() { try { return !!localStorage.getItem(this.KEY); } catch (e) { return false; } },
  write(data) { try { localStorage.setItem(this.KEY, JSON.stringify(data)); } catch (e) { } },
  clear() { try { localStorage.removeItem(this.KEY); } catch (e) { } },
  loadMeta() {
    let m = null; try { m = JSON.parse(localStorage.getItem(this.META)); } catch (e) { }
    return Object.assign({ points: 0, perks: [], best: 0, runs: 0, kills: 0, tutDone: false }, m || {});
  },
  writeMeta(m) { try { localStorage.setItem(this.META, JSON.stringify(m)); } catch (e) { } },
  loadSettings() {
    let s = null; try { s = JSON.parse(localStorage.getItem(this.SET)); } catch (e) { }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const touch = 'ontouchstart' in window; const lowEnd = !ios && (navigator.hardwareConcurrency || 4) <= 4;
    return Object.assign({ gfx: ios ? 'med' : lowEnd ? 'low' : touch ? 'med' : 'high', sound: true, volume: 0.8, sens: 1, fov: 72, invert: false, autoClose: true, flashlight: true, aimAssist: true }, s || {});
  },
  writeSettings(s) { try { localStorage.setItem(this.SET, JSON.stringify(s)); } catch (e) { } },
};
