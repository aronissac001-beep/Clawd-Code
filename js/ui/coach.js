// First-run coach marks. Each step appears once, near the UI it describes,
// and completes on an in-game event rather than a click-through wall of text.
import { el, tapButton } from './dom.js';

const STEPS = [
  { id: 'farm', text: 'Your people need food. Drag a Farm from the build bar onto open land, then tap the check mark.', target: '.item[data-type="farm"]', done: 'placed:farm', day: true },
  { id: 'lumber', text: 'Villagers build on their own. Now place a Lumber Camp near trees: the ghost circles the trees it can reach.', target: '.item[data-type="lumber"]', done: 'placed:lumber', day: true },
  { id: 'pan', text: 'Drag the map to look around and pinch to zoom. Long-press anything to learn what it does.', target: null, ok: true, day: true },
  { id: 'house', text: 'Houses raise your population cap and pay gold. Newcomers arrive while there is food and room.', target: '.item[data-type="house"]', done: 'placed:house', after: 'placed:lumber', day: true },
  { id: 'dusk', text: 'Dusk! The red markers show where the Hollow will strike and how many. Villagers are heading inside.', target: null, ok: true, trigger: 'dusk' },
  { id: 'sov', text: 'Tap the Sovereign portrait to give orders. Time slows. Then tap the ground to move, or a foe to attack.', target: '.portrait', done: 'select:sov', trigger: 'night' },
  { id: 'nova', text: 'Heartflame Nova blasts every Hollow near the Sovereign. Use it when they crowd in.', target: '.abilities .hbtn', ok: true, trigger: 'nightmid' },
  { id: 'dawn', text: 'You held the night! Survive the nights shown top right, then Light the Beacon to win the region.', target: '.objective', ok: true, trigger: 'dawnclosed' },
  { id: 'defense', text: 'Watchtowers shoot on their own. A Barracks trains squads. Walls slow the Hollow; Braziers light the dark.', target: '.tab[data-cat="defense"]', ok: true, trigger: 'day2', day: true },
];

export class Coach {
  constructor(root, meta, save) {
    this.root = root; this.meta = meta; this.save = save;
    this.done = new Set(meta.coachDone || []);
    this.flags = new Set();
    this.node = null; this.step = null;
    this.enabled = !meta.tutorialDone;
  }
  event(name) {
    if (!this.enabled) return;
    this.flags.add(name);
    if (this.step && this.step.done === name) this.finish();
    else if (!this.step) for (const s of STEPS) if (s.done === name) this.done.add(s.id);
    this.next();
  }
  next() {
    if (!this.enabled || this.step) return;
    for (const s of STEPS) {
      if (this.done.has(s.id)) continue;
      if (s.trigger && !this.flags.has(s.trigger)) continue;
      if (s.after && !this.flags.has(s.after)) continue;
      this.show(s);
      return;
    }
    if (STEPS.every((s) => this.done.has(s.id))) { this.meta.tutorialDone = true; this.persist(); this.enabled = false; }
  }
  show(s) {
    this.step = s;
    const n = el('div', 'coach panel');
    n.appendChild(el('div', 'ctext')).textContent = s.text;
    const acts = el('div', 'actions');
    const skip = el('button', 'cbtn', 'Skip all tips');
    tapButton(skip, () => { this.enabled = false; this.meta.tutorialDone = true; this.persist(); this.hide(); });
    const ok = el('button', 'cbtn gold', s.ok ? 'Got it' : 'Hide');
    tapButton(ok, () => this.finish());
    acts.append(skip, ok);
    n.appendChild(acts);
    this.root.appendChild(n);
    this.node = n;
    this.position();
  }
  position() {
    document.querySelectorAll('.coach-target').forEach((e) => e.classList.remove('coach-target'));
    if (!this.node || !this.step) return;
    const t = this.step.target ? document.querySelector(this.step.target) : null;
    if (t) t.classList.add('coach-target');
  }
  // Day-only tips wait out the night instead of covering the battle.
  update(phase, cardOpen) {
    if (!this.node || !this.step) return;
    const hideNow = (this.step.day && phase !== 'day') || cardOpen;
    this.node.classList.toggle('hidden', hideNow);
  }
  finish() {
    if (this.step) this.done.add(this.step.id);
    this.hide();
    this.persist();
    setTimeout(() => this.next(), 600);
  }
  // Hidden (not dismissed) while the player is placing a building.
  suppress(on) { if (this.node) { this.node.style.visibility = on ? 'hidden' : ''; } }
  hide() { if (this.node) this.node.remove(); this.node = null; this.step = null; this.position(); }
  persist() { this.meta.coachDone = [...this.done]; this.save(this.meta); }
  reset() { this.hide(); this.flags.clear(); }
}
