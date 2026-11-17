// The smith work giver (owner E): bills at smith workbenches, from the shared bench-giver factory
// (givers/craft.js). Registered from the stage that brings its benches (not in the 1a slice).

import { benchGiver } from './craft.js';

export const GIVER = benchGiver('smith');
