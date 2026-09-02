import * as THREE from "three/webgpu";
import { Fn, positionWorld, mix, color, mx_noise_float, clamp } from "three/tsl";
import { computeGroundBrightness } from "./GroundLight";

const GROUND_SIZE = 2000; // generous margin so walking far doesn't run off the edge
const GROUND_COLOR_LOW = "#0b0612";
const GROUND_COLOR_HIGH = "#2a1540";

export function buildGround(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
  geometry.rotateX(-Math.PI / 2);

  // Lambert (not Basic) so it actually receives real shadows/lighting from
  // scene lights — colorNode still fully controls the albedo (noise + streak)
  const material = new THREE.MeshLambertNodeMaterial();
  material.colorNode = Fn(() => {
    const n = mx_noise_float(positionWorld.xz.mul(0.05), 1, 0);
    const t = clamp(n.mul(0.5).add(0.5), 0, 1);
    const baseColor = mix(color(GROUND_COLOR_LOW), color(GROUND_COLOR_HIGH), t);

    // elongated, soft-edged light streak centered on the player (GroundLight.ts)
    const groundBrightness = computeGroundBrightness(positionWorld);

    return baseColor.mul(groundBrightness);
  })();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -0.001; // avoid z-fighting with blade bases
  mesh.receiveShadow = true;
  return mesh;
}
