// World generation tables: rock layers and deposits (doc 3.2). OWNER B.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  rockLayer: [
    { id: 'middle', name: 'Middle', depth: [5, 12], stones: ['granite'], work: 20 },
    { id: 'deep', name: 'Deep', depth: [13, 22], stones: ['granite'], work: 30 },
  ],
  deposit: [
    { id: 'coal', item: 'coal', depth: [2, 14], veins: [10, 14], yield: 6 },
    { id: 'iron', item: 'ore', mat: 'iron', depth: [6, 20], veins: [7, 10], yield: 4 },
  ],
};
