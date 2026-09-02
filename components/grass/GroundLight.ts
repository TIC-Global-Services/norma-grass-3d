import * as THREE from "three/webgpu";
import { Fn, float, clamp, uniform, mix, vec2, length, smoothstep, mx_noise_float } from "three/tsl";
import type { Node } from "three/webgpu";
import { uSunDir } from "./lighting";
import { uniforms } from "./config";

// An elongated, soft-edged light streak on the ground, centered on the
// player and aligned with the sun's horizontal direction — art-directable
// (length/width/softness) rather than derived from real 3D light geometry,
// since an exact cone/plane intersection was too small and hard-edged to
// read as the long soft photographic streak this is meant to resemble.
export const groundLightConfig = {
  LENGTH: uniform(64),
  WIDTH: uniform(13),
  SOFTNESS: uniform(0.45), // fraction of the shape used as the fade-out band
  EDGE_NOISE_STRENGTH: uniform(0.12), // breaks up the edge so it isn't a perfect ellipse
  MIN_BRIGHTNESS: uniform(0.05),
};

// ground-plane direction the streak points along
const uBeamDirXZ = uniform(new THREE.Vector2(0, 1));

// call once per frame — keeps the streak's direction following the sun (a
// no-op today since sunDir never changes, but harmless to keep calling)
export function updateGroundLightDirection() {
  const dx = uSunDir.value.x;
  const dz = uSunDir.value.z;
  const len = Math.hypot(dx, dz) || 1;
  uBeamDirXZ.value.set(dx / len, dz / len);
}

export const computeGroundBrightness = Fn<[worldPos: Node<"vec3">], Node<"float">>(([worldPos]) => {
  const offset = worldPos.xz.sub(uniforms.uPlayerPosition.xz);
  const beamDir = uBeamDirXZ;
  const perpDir = vec2(beamDir.y.negate(), beamDir.x);

  const along = offset.dot(beamDir).div(groundLightConfig.LENGTH);
  const across = offset.dot(perpDir).div(groundLightConfig.WIDTH);

  const edgeNoise = mx_noise_float(worldPos.xz.mul(0.06), 1, 0).mul(groundLightConfig.EDGE_NOISE_STRENGTH);
  const shapeT = length(vec2(along, across)).add(edgeNoise);

  const innerEdge = float(1).sub(groundLightConfig.SOFTNESS);
  const brightness = float(1).sub(smoothstep(innerEdge, 1, shapeT));

  return mix(groundLightConfig.MIN_BRIGHTNESS, float(1), clamp(brightness, 0, 1));
});
