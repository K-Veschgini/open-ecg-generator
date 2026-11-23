/**
 * Backwards-compatible name for the pathology presets.
 *
 * Earlier versions had two diverging preset tables (PATHOLOGY_PARAMS and
 * ENHANCED_PATHOLOGY_PARAMS) whose functions applied deltas to a base
 * parameter set and partly used Math.random. Both names now refer to the
 * same deterministic, fully resolved presets: `ENHANCED_PATHOLOGY_PARAMS[p]()`
 * returns `getPathologyParams(p)` (the optional `base` argument is ignored).
 * Extra components that used to be listed here (U wave, R', ST elevation,
 * PR depression) are expressed through `ECGSynParameters.extraWaves`.
 */

export { PATHOLOGY_PARAMS as ENHANCED_PATHOLOGY_PARAMS } from './pathologies.js';
