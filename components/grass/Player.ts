import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { playerConfig } from "./playerConfig";
import { INDIRECT_FIRST_INSTANCE_FEATURE } from "./Grass";

// GLB source textures ship at 4096x4096 — decoded to GPU memory that's
// 4096*4096*4 = 64MB for a SINGLE map, way more than a ~6-unit-tall on-screen
// character needs and a very plausible trigger for "WebGL Device Lost" on
// real mobile GPUs (confirmed happening on an actual phone, not just a
// simulated/headless one). Downscale before upload; go tighter still on the
// WebGL2 fallback backend where memory budgets are smaller.
const MAX_TEXTURE_SIZE = 2048;
const MAX_TEXTURE_SIZE_LOW_POWER = 1024;

function downscaleTexture(texture: THREE.Texture, maxSize: number) {
  const image = texture.image as { width?: number; height?: number } | undefined;
  if (!image?.width || !image?.height) return;
  if (image.width <= maxSize && image.height <= maxSize) return;

  const scale = maxSize / Math.max(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.drawImage(image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  texture.image = canvas;
  texture.needsUpdate = true;
}

type PlayerModel = {
  url: string;
  // which animation clip is the walk cycle — by index (GLB has no useful
  // clip names) or by exact name, whichever the file actually has
  walkClip: number | string;
  // does this model's authored forward axis need flipping 180° so its back
  // (not face) ends up toward the camera, which sits behind the direction
  // of travel (FORWARD = local -Z)? varies per source file/rig.
  needsYFlip: boolean;
};

const PLAYER_MODELS = {
  charcter: { url: "/charcter.glb", walkClip: 12, needsYFlip: false },
  walkingMen: { url: "/walking_men.glb", walkClip: "Take 001", needsYFlip: true },
  blackShirt: { url: "/chracter_black_shirt.glb", walkClip: 3, needsYFlip: true },
} satisfies Record<string, PlayerModel>;

// swap the character model by changing this one line
const ACTIVE_MODEL: keyof typeof PLAYER_MODELS = "blackShirt";

const TARGET_HEIGHT_METERS = 1.8; // one-time load-time normalization baseline; live "size" is root.scale (see debugPanel.ts)

const FORWARD = new THREE.Vector3(0, 0, -1);

export class Player {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private scrollVelocity = 0;
  private forward = new THREE.Vector3();

  private constructor(model: THREE.Object3D, mixer: THREE.AnimationMixer, walkAction: THREE.AnimationAction | null) {
    if (PLAYER_MODELS[ACTIVE_MODEL].needsYFlip) model.rotation.y += Math.PI;
    this.root.add(model);
    this.root.rotation.y = playerConfig.INITIAL_YAW;
    this.mixer = mixer;
    walkAction?.play();
  }

  static async load(renderer: THREE.WebGPURenderer): Promise<Player> {
    const { url, walkClip } = PLAYER_MODELS[ACTIVE_MODEL];
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;

    // default texture anisotropy is 1 (none) — every map goes muddy/blurry
    // the moment the surface isn't dead-on to the camera, which reads as
    // "bad texture quality" even though the source texture is fine.
    // getMaxAnisotropy() can throw on the WebGL2 fallback backend (three.js
    // reads a property off a null WebGL extension object when it's
    // unavailable, or after a mobile GPU context loss from loading several
    // big GLB textures at once) — never let a purely cosmetic feature take
    // the whole scene down with it.
    let maxAnisotropy = 1;
    try {
      maxAnisotropy = renderer.getMaxAnisotropy();
    } catch (err) {
      console.warn("[Player] getMaxAnisotropy failed, skipping anisotropic filtering:", err);
    }
    const isLowPowerBackend = !renderer.hasFeature(INDIRECT_FIRST_INSTANCE_FEATURE);
    const maxTextureSize = isLowPowerBackend ? MAX_TEXTURE_SIZE_LOW_POWER : MAX_TEXTURE_SIZE;
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"] as const) {
          const texture = (material as THREE.MeshStandardMaterial)[key];
          if (!texture) continue;
          downscaleTexture(texture, maxTextureSize);
          texture.anisotropy = maxAnisotropy;
        }
      }
    });

    // GLB is authored in centimeters (~187 units tall); rescale to a real
    // human height and sit the feet on y=0 regardless of the source units.
    const box = new THREE.Box3().setFromObject(model);
    const height = box.max.y - box.min.y;
    const scale = height > 0 ? TARGET_HEIGHT_METERS / height : 1;
    model.scale.setScalar(scale);
    const scaledBox = new THREE.Box3().setFromObject(model);
    model.position.y -= scaledBox.min.y;

    // so he can cast (and receive) a real shadow — the model's original GLTF
    // material is a standard lit PBR material, but nothing in the scene was
    // an actual THREE.Light, so it was rendering essentially unlit/flat
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const mixer = new THREE.AnimationMixer(model);
    const clip =
      (typeof walkClip === "number" ? gltf.animations[walkClip] : THREE.AnimationClip.findByName(gltf.animations, walkClip)) ??
      gltf.animations[0] ??
      null;
    if (!clip) {
      console.warn(`[Player] no walk clip (${walkClip}) found in ${url}; found:`, gltf.animations.map((c) => c.name));
    }
    const action = clip ? mixer.clipAction(clip) : null;

    return new Player(model, mixer, action);
  }

  // feed signed scroll delta (px) here — positive scrolls him forward,
  // negative (scrolling back) reverses him, both easing toward idle when
  // scroll input stops rather than cutting off abruptly
  addScrollInput(deltaY: number) {
    this.scrollVelocity = THREE.MathUtils.clamp(
      this.scrollVelocity + deltaY * playerConfig.SCROLL_TO_VELOCITY,
      -playerConfig.MAX_WALK_SPEED,
      playerConfig.MAX_WALK_SPEED
    );
  }

  update(deltaSeconds: number) {
    const decay = Math.exp(-playerConfig.VELOCITY_DECAY_PER_SECOND * deltaSeconds);
    this.scrollVelocity *= decay;

    if (Math.abs(this.scrollVelocity) > 0.001) {
      this.forward.copy(FORWARD).applyQuaternion(this.root.quaternion);
      const step = this.scrollVelocity * deltaSeconds; // signed: negative walks backward
      this.root.position.addScaledVector(this.forward, step);
    }

    // leg-cycle rate (and direction) tracks walk velocity instead of
    // wall-clock time — negative velocity plays the walk cycle in reverse,
    // so retreating looks like walking backward, not sliding
    const animSpeed = THREE.MathUtils.clamp(this.scrollVelocity / playerConfig.BASE_WALK_SPEED, -3, 3);
    this.mixer.update(deltaSeconds * animSpeed);
  }

  get position() {
    return this.root.position;
  }

  get yaw() {
    return this.root.rotation.y;
  }

  dispose() {
    this.mixer.stopAllAction();
  }
}
