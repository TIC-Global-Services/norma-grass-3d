import * as THREE from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { buildGround } from "./ground";
import { loadEnvironmentMap } from "./environment";
import { Grass } from "./Grass";
import { Player } from "./Player";
import { PlayerCamera, playerCameraConfig } from "./PlayerCamera";
import { updateCameraUniforms } from "./CameraUniforms";
import { updateGameTime } from "./GameTime";
import { clearCursor, setCursorWorldPosition } from "./cursor";
import {
  createDevPanel,
  debugGrass,
  debugInteraction,
  debugPlayer,
  debugPlayerCamera,
  debugGroundLight,
  debugBloom,
  debugSceneLighting,
} from "./debugPanel";
import { PerformanceMonitor } from "./PerformanceMonitor";
import { config, uniforms } from "./config";
import { playerConfig } from "./playerConfig";
import { updateGroundLightDirection } from "./GroundLight";
import { uSunDir, uSunColor, uHemiSkyColor, uHemiGroundColor } from "./lighting";

// bloom strength/radius/threshold tuned for a soft "premium" glow on the
// lit grass/streak rather than blowing out the whole frame
const BLOOM_STRENGTH = 0.85;
const BLOOM_RADIUS = 0.4;
const BLOOM_THRESHOLD = 0.25;

// grass/ground previously only had shader-baked fake lighting — no actual
// THREE.Light existed in the scene, so the player's standard GLTF material
// rendered essentially unlit. These give him (and the ground, for his
// shadow) a real light to respond to, reusing the same sun/hemi values the
// fake grass lighting already uses for visual consistency.
const SUN_LIGHT_INTENSITY = 10;
const SUN_LIGHT_DISTANCE = 30; // how far back along -sunDir the light sits from its target
const HEMI_LIGHT_INTENSITY = 2.5;
const SHADOW_MAP_SIZE = 1024;
const SHADOW_FRUSTUM_HALF_SIZE = 12; // shadow only needs to cover the area right around the player
const SHADOW_CAMERA_FAR = 60;
const SHADOW_BIAS = -0.01;

const TONE_MAPPING_EXPOSURE = 1;

const BACKGROUND_COLOR = new THREE.Color("#050208");

// Matches revo-realms' SceneManager.ts base camera (45, aspect, 0.5, 150) —
// PlayerCamera.ts then follows the player (position + facing) every frame,
// so the world moves and turns with him instead of sitting fixed.
const CAMERA_FOV = 45;
const CAMERA_NEAR = 0.5;
const CAMERA_FAR = 150;

const PLAYER_SIZE = 6.5;

// camera OFFSET.x drifts from wherever it's set to this by the time the
// scroll pin finishes, tied directly to scroll progress (0..1 across the pin)
const CAMERA_OFFSET_X_END = 19;

export interface GrassSceneHandle {
  start: () => void;
  dispose: () => void;
  onResize: () => void;
}

export async function createGrassScene(
  renderer: THREE.WebGPURenderer,
  canvas: HTMLCanvasElement
): Promise<GrassSceneHandle> {
  const scene = new THREE.Scene();

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // real lights (sun intensity 10) were rendering with no tone curve at all —
  // anything past 1.0 just clipped to flat white, killing the shading
  // gradient that makes the model read as 3D instead of flat/plasticky
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    canvas.clientWidth / canvas.clientHeight,
    CAMERA_NEAR,
    CAMERA_FAR
  );

  // dark moody backdrop per the reference look; the cubemap is kept as
  // scene.environment (feeds IBL reflections on the player's real PBR
  // material) rather than shown as sky, since a bright skybox would fight
  // the near-black vignette
  const environmentMap = await loadEnvironmentMap();
  scene.environment = environmentMap;
  scene.background = BACKGROUND_COLOR;

  const groundMesh = buildGround();
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // real sun light so the player (and his shadow on the ground) actually
  // render lit — grass/ground brightness stays driven by the fake shader
  // math above (SpriteNodeMaterial doesn't respond to real lights anyway).
  // Grass itself does NOT sample this shadow map (tried it — per-fragment
  // shadow lookup across ~500k blade instances tanked fps to ~12); his
  // shadow only lands on the ground plane.
  const sunLight = new THREE.DirectionalLight(uSunColor.value, SUN_LIGHT_INTENSITY);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sunLight.shadow.bias = SHADOW_BIAS;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = SHADOW_CAMERA_FAR;
  sunLight.shadow.camera.left = -SHADOW_FRUSTUM_HALF_SIZE;
  sunLight.shadow.camera.right = SHADOW_FRUSTUM_HALF_SIZE;
  sunLight.shadow.camera.top = SHADOW_FRUSTUM_HALF_SIZE;
  sunLight.shadow.camera.bottom = -SHADOW_FRUSTUM_HALF_SIZE;
  sunLight.shadow.camera.updateProjectionMatrix();
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemiLight = new THREE.HemisphereLight(uHemiSkyColor.value, uHemiGroundColor.value, HEMI_LIGHT_INTENSITY);
  scene.add(hemiLight);

  const updateSunLight = (focusPosition: THREE.Vector3) => {
    sunLight.target.position.copy(focusPosition);
    sunLight.position.copy(focusPosition).addScaledVector(uSunDir.value, -SUN_LIGHT_DISTANCE);
  };

  // only the clumps inside the camera's frustum ever get appended to the
  // indirect draw list, so grass outside view costs nothing to render
  const grass = new Grass(renderer);
  scene.add(grass.tile);
  await grass.init();

  const player = await Player.load(renderer);
  player.root.scale.setScalar(PLAYER_SIZE);
  scene.add(player.root);

  // grass tile re-centers on him every frame (see animate loop below), so the
  // field moves with him instead of him walking out of a fixed patch
  grass.setViewerPosition(player.position.x, player.position.z);
  updateSunLight(player.position);

  const playerCamera = new PlayerCamera(camera, player.position, player.yaw);
  updateGroundLightDirection();
  const cameraOffsetXStart = playerCameraConfig.OFFSET.x;

  const scenePass = pass(scene, camera);
  const scenePassColor = scenePass.getTextureNode("output");
  const bloomPass = bloom(scenePassColor, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
  const renderPipeline = new THREE.RenderPipeline(renderer);
  const setBloomEnabled = (enabled: boolean) => {
    renderPipeline.outputNode = enabled ? scenePassColor.add(bloomPass) : scenePassColor;
    // outputNode is a plain property, not auto-tracked — RenderPipeline only
    // rebuilds its fullscreen-quad material when this flag is set
    renderPipeline.needsUpdate = true;
  };
  setBloomEnabled(true);

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointerNdc = new THREE.Vector2();
  const groundHit = new THREE.Vector3();

  const onPointerMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, groundHit)) {
      setCursorWorldPosition(groundHit.x, groundHit.z);
    }
  };
  const onPointerLeave = () => clearCursor();

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);

  const devPanel = await createDevPanel();
  let perfMonitor: PerformanceMonitor | null = null;
  if (devPanel) {
    debugGrass(devPanel, uniforms, config);
    debugInteraction(devPanel);
    debugPlayer(devPanel, player);
    debugPlayerCamera(devPanel);
    debugGroundLight(devPanel);
    debugBloom(devPanel, bloomPass, setBloomEnabled);
    debugSceneLighting(devPanel, sunLight, hemiLight, renderer);
    perfMonitor = new PerformanceMonitor(devPanel, renderer, grass);
  }

  let lastTime = performance.now();
  let lastScrollProgress = 0;

  // real window.scrollY drives the walk, sampled once per frame — the hero
  // sits in a CSS position:sticky pin (see GrassScene.tsx) of height
  // SCROLL_INTRO_THRESHOLD_PX, at the top of the document, so scrollY over
  // that range maps 1:1 to intro progress in both directions: scroll down to
  // walk forward, scroll back up (even after reaching the next section) to
  // walk him back and re-pin, exactly like a standard pinned-scroll section
  const animate = () => {
    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    const scrollProgress = THREE.MathUtils.clamp(window.scrollY, 0, playerConfig.SCROLL_INTRO_THRESHOLD_PX);
    const scrollDelta = scrollProgress - lastScrollProgress;
    lastScrollProgress = scrollProgress;
    if (scrollDelta !== 0) player.addScrollInput(scrollDelta);

    const scrollT = scrollProgress / playerConfig.SCROLL_INTRO_THRESHOLD_PX;
    playerCameraConfig.OFFSET.x = THREE.MathUtils.lerp(cameraOffsetXStart, CAMERA_OFFSET_X_END, scrollT);

    updateGameTime(delta);
    player.update(delta);
    playerCamera.update(delta, player.position, player.yaw);
    updateSunLight(player.position);
    grass.setViewerPosition(player.position.x, player.position.z);
    updateCameraUniforms(camera);
    grass.update();

    renderPipeline.render();
    perfMonitor?.sample(delta);
  };

  function start() {
    renderer.setAnimationLoop(animate);
  }

  function onResize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function dispose() {
    renderer.setAnimationLoop(null);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    perfMonitor?.dispose();
    devPanel?.dispose();
    player.dispose();
    grass.dispose();
    renderPipeline.dispose();
    environmentMap.dispose();
  }

  onResize();

  return { start, dispose, onResize };
}
