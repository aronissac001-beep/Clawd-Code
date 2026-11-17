// Needs, in the fixed core order NEED_IDS (doc 4.4). OWNER F.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  need: [
    { id: 'food', name: 'Food', fallPerDay: 33, thoughts: [{ below: 25, thought: 'hungry' }] },
    { id: 'rest', name: 'Rest', fallPerDay: 99, thoughts: [{ below: 15, thought: 'tired' }] },
    { id: 'joy', name: 'Joy', fallPerDay: 30, thoughts: [] },
    { id: 'warmth', name: 'Warmth', fallPerDay: 0, thoughts: [] },
    { id: 'light', name: 'Light', fallPerDay: 0, thoughts: [] },
  ],
};
