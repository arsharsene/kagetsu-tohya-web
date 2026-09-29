/* Set base to a CDN/bucket URL (ending with "/") if you host the media outside of Vercel. */
window.KT_CONFIG = {
  base: 'a/',
  script: 'game/script.txt',
  maxScale: 4,
  tracks: [2, 17],
  seedFile: 'game/seed.json',
  /* seed:true pre-loads the progress from the bundled save (gloval.sav) into every
     new visitor's browser - only sensible for a single personal deployment.
     Keep this false for any deployment other people can reach, so everyone
     starts a genuinely fresh game. */
  seed: false
};
