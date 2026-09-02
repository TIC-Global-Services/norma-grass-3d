import { Vector2 } from "three";
import { uniform } from "three/tsl";

// Stands in for revo-realms' WindManager, which drives directional gust
// "events" from player swipe input. We have no such input here, so direction
// is fixed and the event intensity is pinned at 0 — the noise-driven ambient
// gust field in GrassCompute keeps animating regardless.
export const uWindDirection = uniform(new Vector2(0.6, 0.8).normalize());
export const uWindIntensityDirectional = uniform(0);
