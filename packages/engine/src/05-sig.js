// ── RIDD Indicators Engine — extracted verbatim from src/66-scorecards.js ──
// Shared by the app bundle (app.js) and the standalone engine build
// (engine/dist/ridd-engine.js). Edit HERE; both pick it up.

// Rep name signature: lowercase, punctuation dropped, tokens sorted — so
// "Murray, Karson" and "Karson Murray" collapse to one key.
function _repTypeNameSig(n) { return String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' '); }
