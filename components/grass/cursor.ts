import { Vector2 } from "three";
import { uniform } from "three/tsl";

// world-space XZ the cursor is currently hovering (parked far away = no effect)
export const uCursorPosition = uniform(new Vector2(1e6, 1e6));
export const uCursorRadius = uniform(15);
export const uCursorStrength = uniform(0);

export function setCursorWorldPosition(x: number, z: number) {
  uCursorPosition.value.set(x, z);
}

export function clearCursor() {
  uCursorPosition.value.set(1e6, 1e6);
}
