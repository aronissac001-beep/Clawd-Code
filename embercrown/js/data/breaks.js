// Mental breaks (doc 4.5). OWNER F. job names the behaviour (people/needjobs.js); stage is the build
// stage whose sim has it: Stage 1b ships the two minor breaks, the rest arrive in Stage 2. While a
// severity has no break available, the next milder one is used.
export const DATA = {
  break: [
    { id: 'sulk', name: 'Sulk', sev: 'minor', hours: [4, 8], job: 'sulk', stage: '1b', text: 'Wanders the hold and will not work.' },
    { id: 'binge', name: 'Comfort binge', sev: 'minor', hours: [4, 6], job: 'binge', stage: '1b', text: 'Eats two meals, hungry or not.' },
    { id: 'tantrum', name: 'Tantrum', sev: 'major', hours: [4, 10], stage: '2', text: 'Smashes one to three items or pieces of furniture.' },
    { id: 'catatonic', name: 'Catatonic', sev: 'extreme', hours: [16, 48], stage: '2', text: 'Lies in bed for two days.' },
  ],
};
