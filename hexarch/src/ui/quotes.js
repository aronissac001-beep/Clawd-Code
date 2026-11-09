// ===== quotes.js : what each leader says, by mood =====
const LEADER_LINES = {
  aurelian: { Hostile: ['Your name is already written in our ledger of fools.', 'The Compact has measured you, and found you wanting.'], Wary: ['We are watching your libraries, and your legions.', 'Speak plainly. Archons have little patience.'],
    Neutral: ['The Compact listens. Bring reason, not noise.', 'Knowledge is the only border worth guarding.'], Friendly: ['Our scholars speak well of your people.', 'Come, share what you have learned.'], Devoted: ['Between us, the whole world could be catalogued.', 'Friend, our archives are open to you.'] },
  thornwall: { Hostile: ['Our walls have outlasted better armies than yours.', 'Every stone of Thornwall remembers your insult.'], Wary: ['Keep your soldiers off our marches.', 'The gate is closed. State your business.'],
    Neutral: ['The Marches keep to themselves. Mostly.', 'We trade, we watch, we wait.'], Friendly: ['You are welcome at our hearths.', 'A good neighbor is the best wall.'], Devoted: ['Our banners will fly beside yours.', 'Thornwall does not forget its friends.'] },
  sunreach: { Hostile: ['The steppe is wide enough to bury you.', 'Our riders already know the road to your cities.'], Wary: ['You smell of walls and fear.', 'Speak quickly; the horses grow restless.'],
    Neutral: ['The sky is big. There is room for both of us. For now.', 'We ride where we please.'], Friendly: ['Ride with us a while, friend.', 'Your roads are good. Your horses could be better.'], Devoted: ['Our herds are your herds.', 'Call, and ten thousand riders answer.'] },
  meridian: { Hostile: ['Your credit with the League is exhausted.', 'We will see your ports empty and your coffers dry.'], Wary: ['Every deal with you costs more than it should.', 'The League has questions about your intentions.'],
    Neutral: ['Everything has a price. Shall we find yours?', 'Coin flows; so should conversation.'], Friendly: ['Our merchants toast your name.', 'A pleasure, as always. Shall we trade?'], Devoted: ['Partners in every venture, friend.', 'The League would sail through storms for you.'] },
  verdant: { Hostile: ['The forest grows over every fallen city. Remember that.', 'You cut what you do not understand.'], Wary: ['Tread softly in our groves.', 'The old trees whisper your name, and not kindly.'],
    Neutral: ['Seasons turn. So do friendships.', 'Sit, listen to the leaves, then speak.'], Friendly: ['You walk gently. The Circle approves.', 'May your harvests be long.'], Devoted: ['Our roots are tangled now, yours and ours.', 'The Circle sings of you.'] },
  emberforge: { Hostile: ['We will melt your crown into nails.', 'The forge is hot, and you are cold iron.'], Wary: ['Mind your hammers near our mountains.', 'Clans do not forget a slight.'],
    Neutral: ['Talk is cheap. Iron is not.', 'Bring ore, or bring an offer.'], Friendly: ['You strike true. The clans like that.', 'Our anvils ring for our friends.'], Devoted: ['Forge-kin, our fire is yours.', 'Name the blade, and we will make it.'] },
  frostmark: { Hostile: ['Winter comes for you, and so do we.', 'The ice keeps the bones of our enemies.'], Wary: ['Long nights make for short tempers.', 'You are far from home. Why?'],
    Neutral: ['Sit by the fire. Speak.', 'The Holds endure. What do you want?'], Friendly: ['Our mead halls are open to you.', 'Warm greetings from a cold land.'], Devoted: ['Shield-friend, we stand together.', 'Our skalds already sing of you.'] },
  coralline: { Hostile: ['The tide will take your harbors.', 'Every reef has a sharp edge. You will find ours.'], Wary: ['Your ships sail too close to our waters.', 'The sea remembers every wrong.'],
    Neutral: ['Currents shift. Let us see where this one goes.', 'Come, the water is calm today.'], Friendly: ['Fair winds to you, friend.', 'Our pearl-divers speak your name kindly.'], Devoted: ['Wherever the sea reaches, you are welcome.', 'The Tide-Queen calls you kin.'] },
};
function leaderLine(G, pid, mood) {
  const key = CIVS[G.players[pid].civ].key, lines = (LEADER_LINES[key] || {})[mood];
  if (!lines) return '';
  return lines[(G.turn + pid) % lines.length];
}
