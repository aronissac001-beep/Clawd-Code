// Traits (exclusive pairs point at each other) (doc 4.3). OWNER F.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  trait: [
    { id: 'hardworking', name: 'Hardworking', excl: 'lazy', weight: 10, mods: [{ key: 'work.speed', op: 'pct', value: 15 }], text: 'Works 15% faster.' },
    { id: 'lazy', name: 'Lazy', excl: 'hardworking', weight: 10, mods: [{ key: 'work.speed', op: 'pct', value: -15 }], text: 'Works 15% slower.' },
    { id: 'dark_sighted', name: 'Dark-sighted', weight: 6, mods: [{ key: 'work.dark', op: 'flag', value: true }], text: 'No work penalty and no dread in darkness.' },
  ],
};
