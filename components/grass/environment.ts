import * as THREE from "three/webgpu";

const FACES = ["px.webp", "nx.webp", "py.webp", "ny.webp", "pz.webp", "nz.webp"];

export function loadEnvironmentMap(): Promise<THREE.CubeTexture> {
  return new Promise((resolve, reject) => {
    new THREE.CubeTextureLoader().setPath("/textures/environment/").load(
      FACES,
      (cubeTexture) => {
        cubeTexture.colorSpace = THREE.SRGBColorSpace;
        resolve(cubeTexture);
      },
      undefined,
      reject
    );
  });
}
