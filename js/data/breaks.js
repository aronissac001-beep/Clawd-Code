// Mental breaks (doc 4.5). OWNER F. job names the behaviour (people/needjobs.js); stage is the build
// stage whose sim has it: Stage 1b ships the two minor breaks, Stage 2 the rest. While a severity has
// no break available, the next milder one is used. trait: only colonists with that trait have it.
export const DATA = {
  break: [
    { id: 'sulk', name: 'Sulk', sev: 'minor', hours: [4, 8], job: 'sulk', stage: '1b', text: 'Wanders the hold and will not work.' },
    { id: 'binge', name: 'Comfort binge', sev: 'minor', hours: [4, 6], job: 'binge', stage: '1b', text: 'Eats two meals, hungry or not.' },
    { id: 'hide', name: 'Hide in room', sev: 'minor', hours: [4, 10], job: 'hide', stage: '2', text: 'Shuts themselves in their room and will not come out.' },
    { id: 'tantrum', name: 'Tantrum', sev: 'major', hours: [4, 10], job: 'tantrum', stage: '2', text: 'Smashes one to three items or pieces of furniture.' },
    { id: 'dark_wander', name: 'Dark wander', sev: 'major', hours: [4, 8], job: 'darkwander', stage: '2', text: 'Walks off into the unlit tunnels, dread growing.' },
    { id: 'insult_spree', name: 'Insult spree', sev: 'major', hours: [4, 8], job: 'insult', stage: '2', text: 'Goes from one colonist to the next with cruel words.' },
    { id: 'hollow_whispered', name: 'Hollow-whispered', sev: 'extreme', hours: [8, 16], job: 'whispered', stage: '2',
      text: 'Walks toward the Grey Edge, listening. Talk them down before they reach it.' },
    { id: 'catatonic', name: 'Catatonic', sev: 'extreme', hours: [16, 48], job: 'catatonic', stage: '2', text: 'Lies in bed for two days.' },
    { id: 'firestarter', name: 'Firestarter', sev: 'extreme', hours: [2, 6], job: 'firestarter', trait: 'pyromaniac', stage: '2', text: 'Sets the hold alight.' },
  ],
};
