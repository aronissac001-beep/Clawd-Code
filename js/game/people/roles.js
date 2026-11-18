// Roles and work priorities (doc 5.1). Owner F. Provisional API.
//
// col.role = [primary, secondary | null] (role ids, js/data/roles.js); col.prio = Uint8Array(13)
// in WORK_IDS order, 0 = off, 1 (highest) - 4. The sim only reads col.prio. Unless col.custom,
// col.prio is COMPUTED from the roles, never typed:
//   1. the primary role's values (a role with `all` sets every work type to it);
//   2. the secondary role's 1s become 2s and its 2s become 3s, keeping the better value;
//   3. every other enabled work type 4;
//   4. Care is 2 for anyone with Medicine 6+ (unless opted out), when that is better;
//   5. work types a backstory disables stay 0 (off), whatever the roles say.
// Editing a cell (the `prio` command, Advanced grid) marks the colonist custom.

import { WORK_IDS } from '../core/schema.js';
import { registerApplier } from '../core/commands.js';
import { colById } from '../core/state.js';
import { requestThink } from '../work/jobs.js';
import { def, all, inStage } from './defs.js';
import { level, SK } from './skills.js';
import { SCHEDULES } from '../../data/roles.js';
import { SCHED } from '../core/schema.js';
import { soldierSquad } from './draft.js';

export const PRIO_OFF = 0, PRIO_LOW = 4;
export const CARE_MEDICINE_LVL = 6;
export const WORK = Object.freeze(Object.fromEntries(WORK_IDS.map((w, i) => [w, i])));

/** Work types disabled by the colonist's backstories (sorted WORK_IDS indexes). */
export function disabledWork(col) {
  const out = [];
  for (const b of col.bs) { const d = def('backstory', b); if (d && d.disables) for (const w of d.disables) if (w in WORK && !out.includes(WORK[w])) out.push(WORK[w]); }
  return out.sort((a, b) => a - b);
}

/**
 * The computed priority array for a colonist's roles (does not write it).
 * @param {object} col
 * @param {{ careOptOut?: boolean }} [opts]
 * @returns {Uint8Array}
 */
export function computePrio(col, { careOptOut = false } = {}) {
  const p = new Uint8Array(WORK_IDS.length).fill(PRIO_LOW);
  const prim = def('role', col.role[0]);
  if (prim) {
    if (prim.all) p.fill(prim.all);
    for (const w of WORK_IDS) if (prim.prio && prim.prio[w]) p[WORK[w]] = prim.prio[w];
  }
  const sec = def('role', col.role[1]);
  if (sec && sec !== prim) {
    for (const w of WORK_IDS) {
      const v = sec.prio && sec.prio[w];
      const nv = v === 1 ? 2 : v === 2 ? 3 : sec.all && sec.all < PRIO_LOW ? sec.all + 1 : 0;
      if (nv && nv < p[WORK[w]]) p[WORK[w]] = nv;
    }
  }
  if (!careOptOut && level(col, 'medicine') >= CARE_MEDICINE_LVL && p[WORK.care] > 2) p[WORK.care] = 2;
  for (const i of disabledWork(col)) p[i] = PRIO_OFF;
  return p;
}

/** Recompute col.prio from roles (skipped for custom colonists) and apply the roles' soldier flag. */
export function applyRoles(s, col, opts) {
  if (!col.custom) col.prio = computePrio(col, opts);
  const prim = def('role', col.role[0]), sec = def('role', col.role[1]);
  if ((prim && prim.soldier) || (sec && sec.soldier)) { col.soldier = true; soldierSquad(s, col); }
  return col.prio;
}

// ---- The Advanced grid (10.4) and schedules (5.2) --------------------------------------------------------------
/**
 * The data behind the Advanced priority grid: one row per living colonist (id order), one cell per
 * work type (WORK_IDS order). A cell: { work, p (0 off, 1-4), off (backstory rules it out), skill (the
 * work's best skill id or null), lvl, passion (0-2) }. The role column and the custom mark come with it.
 */
export function workGrid(s) {
  const works = all('worktype');
  return s.col.filter((c) => !c.hp.dead).map((c) => {
    const dis = disabledWork(c);
    const cells = WORK_IDS.map((w, i) => {
      const wt = works.find((x) => x.id === w);
      let skill = null, lv = 0, pa = 0;
      for (const sk of (wt && wt.skills) || []) { const k = SK[sk]; if (k !== undefined && (skill === null || c.sk[k][0] > lv)) { skill = sk; lv = c.sk[k][0]; pa = c.sk[k][2]; } }
      return { work: w, p: c.prio[i], off: dis.includes(i), skill, lvl: lv, passion: pa };
    });
    return { colId: c.id, name: c.name, role: c.role.slice(), custom: !!c.custom, soldier: !!c.soldier, cells };
  });
}
/** The 24 schedule cells of a preset ('day', 'early', 'night'). */
export function schedulePreset(id) {
  const p = SCHEDULES.find((x) => x.id === id) || SCHEDULES[0];
  const a = new Uint8Array(24).fill(SCHED.WORK);
  const inSpan = (h, [a0, a1]) => (a0 <= a1 ? h >= a0 && h < a1 : h >= a0 || h < a1);
  for (let h = 0; h < 24; h++) a[h] = inSpan(h, p.sleep) ? SCHED.SLEEP : inSpan(h, p.joy) ? SCHED.JOY : SCHED.WORK;
  return a;
}
/** Which preset a schedule matches, or 'custom'. */
export function scheduleName(sched) {
  for (const p of SCHEDULES) { const a = schedulePreset(p.id); if (a.every((v, h) => v === sched[h])) return p.id; }
  return 'custom';
}
export { SCHEDULES };


/**
 * A suggested primary role (5.1): the first role (data order) whose priority-1 work uses the
 * colonist's best passion skill; when no role fits that skill (Archery, Social and others in the
 * 1a slice), the next passion skill is tried. 'generalist' when none fits.
 * @param {object} col @param {object[]} roles role defs @param {string|string[]} skillIds best first
 */
export function suggestRole(col, roles, skillIds) {
  for (const id of Array.isArray(skillIds) ? skillIds : [skillIds]) {
    const sk = def('skill', id);
    const works = (sk && sk.work) || [];
    for (const r of roles) if (inStage(r) && r.prio && works.some((w) => r.prio[w] === 1)) return r.id;
  }
  return 'generalist';
}

// ---- Command appliers (C3): role, prio, sched, soldier ------------------------------------------
export function installRoleCommands() {
  registerApplier('role', (s, c) => {
    const col = colById(s, c.colId);
    col.role = [c.primary, c.secondary || null];
    col.custom = false;
    applyRoles(s, col);
    requestThink(s, col.id);
    return { ok: true };
  });
  registerApplier('prio', (s, c) => {
    const col = colById(s, c.colId);
    if (c.p !== PRIO_OFF && disabledWork(col).includes(WORK[c.work])) return { ok: false, reason: 'their past rules out that work' };
    col.custom = true;
    col.prio[WORK[c.work]] = c.p;
    requestThink(s, col.id);
    return { ok: true };
  });
  registerApplier('sched', (s, c) => { colById(s, c.colId).sched = Uint8Array.from(c.hours); return { ok: true }; });
  registerApplier('soldier', (s, c) => { const col = colById(s, c.colId); col.soldier = c.on; soldierSquad(s, col); return { ok: true }; });
}
