/*
  Shared, mutable reference to the resolved salon id.

  server.js sets it at boot. store.js updates it if the salon row is ever
  recreated with a new UUID (seed SQL re-run against a live deployment) so
  the process heals itself instead of 500ing until the next redeploy.
*/
let salonId = null;
module.exports = {
  get: () => salonId,
  set: id => { salonId = id; }
};
