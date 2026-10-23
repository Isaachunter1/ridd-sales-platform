// ──────────────────────────────────────────────────────────────────────────
// Go
// ──────────────────────────────────────────────────────────────────────────
boot().catch(err => {
  // Anything that escapes boot()'s own handling must never strand the user
  // on a forever-splash — show the classified error screen, or reload.
  try { mountError(err); } catch (e) { location.reload(); }
});

