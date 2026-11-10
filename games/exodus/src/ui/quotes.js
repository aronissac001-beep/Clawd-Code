// ===== quotes.js : what each leader says, by mood =====
const LEADER_LINES = {
  halcyon: { Hostile: ['We have modelled your future. It is short.', 'The Accord has published its findings on you. They are unflattering.'], Wary: ['Our sensors are on your borders. And your labs.', 'Your hypotheses about us are wrong.'],
    Neutral: ['Bring data, not demands.', 'Veyra is a puzzle. You are a smaller one.'], Friendly: ['Our researchers enjoy your company.', 'Shall we compare notes?'], Devoted: ['Co-authors of the future, you and I.', 'Our libraries are yours.'] },
  kestrel: { Hostile: ['Your account is closed. Permanently.', 'We are pricing in your collapse.'], Wary: ['Every deal with you has hidden fees.', 'The board has concerns about you.'],
    Neutral: ['Everything has a price, even on Veyra.', 'Credits move. So should you.'], Friendly: ['A pleasure doing business, as always.', 'The Mutual counts you among its preferred partners.'], Devoted: ['Partners for life, and well after.', 'Name your terms. We trust you.'] },
  brightwater: { Hostile: ['You salt every field you touch.', 'The soil remembers what you did.'], Wary: ['Keep your boots off our furrows.', 'We have seen what your kind does to land.'],
    Neutral: ['Sit, eat, then talk.', 'Seasons turn. So do neighbors.'], Friendly: ['Our harvest tables have a place for you.', 'You tread lightly. We notice.'], Devoted: ['Our roots are tangled with yours now.', 'Whatever grows, we share.'] },
  ironveil: { Hostile: ['The Pact has a file on you. It is a target list.', 'We kept order on a dying world. We will keep it here.'], Wary: ['State your business. Slowly.', 'Our patrols have orders regarding you.'],
    Neutral: ['Discipline keeps colonies alive.', 'Speak plainly. We do.'], Friendly: ['You keep your word. Rare, out here.', 'The Marshal respects you.'], Devoted: ['Our guns stand with yours.', 'Brothers and sisters in arms.'] },
  choir: { Hostile: ['Your voice is out of tune with the world.', 'The Veil will close over your colonies.'], Wary: ['We hear discord when you speak.', 'The forest flinches at your name.'],
    Neutral: ['Listen first. Veyra is singing.', 'Every voice finds its place, in time.'], Friendly: ['You are learning the song.', 'The Choir sings of you kindly.'], Devoted: ['We sing as one now.', 'The planet knows your name, and so do we.'] },
  forgeborn: { Hostile: ['We will melt down your arks for scrap.', 'The furnace is hot and you are cold iron.'], Wary: ['Mind your rigs near our ore.', 'The guilds have a long memory.'],
    Neutral: ['Talk is cheap. Alloy is not.', 'Bring ore, or bring an offer.'], Friendly: ['You build well. The guilds like that.', 'Our foundries ring for friends.'], Devoted: ['Forge-kin, our fire is yours.', 'We will build the future together.'] },
  tidecall: { Hostile: ['The violet sea will take your docks.', 'Our hulls have sunk better fleets.'], Wary: ['Your boats sail too close to ours.', 'The sea remembers every slight.'],
    Neutral: ['Currents shift. Let us see where this one runs.', 'The water is calm today. For now.'], Friendly: ['Fair tides to you.', 'Our crews speak your name kindly.'], Devoted: ['Wherever the tide goes, we go together.', 'Our fleet is your fleet.'] },
  pathfinder: { Hostile: ['We know every trail to your colonies.', 'You are lost, and you do not even know it.'], Wary: ['You are a long way from your camp.', 'Watch your step out here.'],
    Neutral: ['The horizon is wide enough for us both.', 'What have you found out there?'], Friendly: ['Walk with us a while.', 'Your maps are good. Ours are better. Let us share.'], Devoted: ['Trail-kin, the whole world is ours to see.', 'Every summit, together.'] },
};
function leaderLine(G, pid, mood) {
  const key = CIVS[G.players[pid].civ].key, lines = (LEADER_LINES[key] || {})[mood];
  if (!lines) return '';
  return lines[(G.turn + pid) % lines.length];
}
