// The AI storytellers (Phase 3). One is chosen on the setup screen and carried by the
// run (run.storyteller -> s.storyteller). The director (js/game/systems/director.js)
// reads these numbers to pace region events and tonight's wave modifiers; weather.js
// reads the storyteller id for its taste in extreme weather ('jester' / 'gentle').
//
//  eventChance     base chance each dawn that a region event comes up (scaled by tension)
//  waveVariance    0..1, how hard a wave modifier bends tonight's plan (share of units affected)
//  breather        chance of a planned Lull (a thinner wave) on the night after a crisis
//                  or after heavy losses
//  modifierChance  base chance each day that tonight's wave carries a hostile modifier
//  extremeWeather  multiplier on storm/heat/snow weights (weather.js keys on the id)
//  crisisCooldown  nights that must pass after a crisis before the next hostile modifier
//  minNight        first night that can carry a hostile modifier
//  stack           chance of a second, stacked hostile modifier on a crisis night
//  toneBias        how strongly event picks follow tension (1 = fully, 0 = ignore it)
//  goodBias        extra weight on kindly events (gentle storytellers favour them)

export const STORYTELLERS = {
  steady: {
    id: 'steady', name: 'The Steady Hand', icon: 'shield',
    desc: 'Tension rises as your realm grows, then eases off with a planned breathing night after each crisis.',
    eventChance: 0.5, waveVariance: 0.55, breather: 0.7, modifierChance: 0.45, extremeWeather: 1,
    crisisCooldown: 2, minNight: 2, stack: 0, toneBias: 1, goodBias: 1,
  },
  gentle: {
    id: 'gentle', name: 'The Gentle Muse', icon: 'book',
    desc: 'Long calm stretches and kindly visitors. Crises are rare and mild. Good for learning the realm.',
    eventChance: 0.4, waveVariance: 0.3, breather: 1, modifierChance: 0.22, extremeWeather: 0.5,
    crisisCooldown: 4, minNight: 3, stack: 0, toneBias: 1, goodBias: 1.8,
  },
  jester: {
    id: 'jester', name: 'The Mad Jester', icon: 'dice',
    desc: 'Anything, anytime. Wild gambles, stacked omens, sudden mercies. Maximum drama.',
    eventChance: 0.7, waveVariance: 1, breather: 0.35, modifierChance: 0.6, extremeWeather: 2,
    crisisCooldown: 0, minNight: 1, stack: 0.3, toneBias: 0.15, goodBias: 1,
  },
};

/** Storytellers in setup-screen order. */
export const STORYTELLER_LIST = [STORYTELLERS.steady, STORYTELLERS.gentle, STORYTELLERS.jester];

/** The storyteller definition for an id (falls back to The Steady Hand). */
export function storytellerDef(id) { return STORYTELLERS[id] || STORYTELLERS.steady; }
