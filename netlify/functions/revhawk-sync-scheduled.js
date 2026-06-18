// RevHawk sync — scheduler (DISABLED for now).
//
// This used to wrap the worker with @netlify/functions' schedule(), but that
// package isn't a declared dependency, which failed the Netlify build. The live
// RevHawk sync isn't wired up yet (waiting on a read-only credential / the
// connector approach), so this is an inert stub that builds cleanly and does
// nothing. When the sync goes live we'll re-add the daily trigger — either via
// a netlify.toml [functions] schedule block or by adding @netlify/functions to
// package.json and restoring the schedule() wrapper.

exports.handler = async () => ({
  statusCode: 200,
  body: 'revhawk sync scheduler is disabled (not configured yet)',
});
