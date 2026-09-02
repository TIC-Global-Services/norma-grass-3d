import { uniform } from "three/tsl";

// A manually-driven time uniform, not TSL's built-in time/deltaTime — those
// only refresh during a render pass (three.js's compute path always builds
// its node frame with camera/time state absent), so anything read inside a
// compute shader needs values pushed from JS instead. Mirrors revo-realms'
// utils/GameTime.ts.
export const gameTime = uniform(0);
export const gameDeltaTime = uniform(0);

let elapsed = 0;

export function updateGameTime(deltaSeconds: number) {
  elapsed += deltaSeconds;
  gameDeltaTime.value = deltaSeconds;
  gameTime.value = elapsed;
}
