import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";

// Same reasoning as GameTime.ts: cameraPosition/cameraViewMatrix/cameraProjectionMatrix
// (TSL built-ins) only populate during a render pass, so the compute shader
// tracks its own camera uniforms, refreshed from JS every frame. Mirrors
// revo-realms' SceneManager (uFx/uFy/uCameraMatrix/uPlayerCameraPosition).
export const uFx = uniform(1);
export const uFy = uniform(1);
export const uCameraMatrix = uniform(new THREE.Matrix4());
export const uPlayerCameraPosition = uniform(new THREE.Vector3());

export function updateCameraUniforms(camera: THREE.PerspectiveCamera) {
  uPlayerCameraPosition.value.copy(camera.position);
  const projectionMatrix = camera.projectionMatrix;
  uFx.value = projectionMatrix.elements[0];
  uFy.value = projectionMatrix.elements[5];
  uCameraMatrix.value.copy(projectionMatrix).multiply(camera.matrixWorldInverse);
}
