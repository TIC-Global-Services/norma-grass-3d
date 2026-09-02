// Live-tunable player walk knobs, read fresh each frame so the dev panel
// (debugPanel.ts) can edit them without a reload. Position/size are tuned
// directly on the live Player instance instead (see debugPanel.ts).
export const playerConfig = {
  SCROLL_TO_VELOCITY: 0.01, // m/s of walk speed per px of wheel deltaY
  MAX_WALK_SPEED: 6, // m/s
  BASE_WALK_SPEED: 2.2, // m/s the walk clip's authored pace matches
  VELOCITY_DECAY_PER_SECOND: 4, // exponential ease-to-idle when scrolling stops

  // fixed facing, set once at spawn — a scripted turn tied to distance
  // walked / light direction was tried and reverted (looked wrong)
  INITIAL_YAW: -2.6,

  // pin height, in px, on top of the 100vh hero — CSS position:sticky holds
  // the hero in place while the page scrolls through this much extra height,
  // during which real scrollY drives the walk (both directions); scrolling
  // back up re-pins automatically, it's just how sticky works
  SCROLL_INTRO_THRESHOLD_PX: 5000,
};
