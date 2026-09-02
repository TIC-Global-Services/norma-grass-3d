import * as THREE from "three/webgpu";
import {
  PI2,
  cos,
  float,
  instancedBufferAttribute,
  length,
  mix,
  sin,
  smoothstep,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { SpriteNodeMaterial } from "three/webgpu";
import { GrassBladeGeometry } from "./GrassBladeGeometry";
import { config, uniforms } from "./config";
import { gameTime } from "./GameTime";
import { uHemiGroundColor, uHemiIntensity, uHemiSkyColor, uSunDir, uSunRadiance } from "./lighting";
import { uCursorPosition, uCursorRadius, uCursorStrength } from "./cursor";
import { computeGroundBrightness } from "./GroundLight";
import type { GrassLike } from "./Grass";

// Devices without the WebGPU `indirect-first-instance` feature (most mobile
// browsers today, even ones with some WebGPU support) can't run Grass.ts's
// compute/indirect-draw pipeline at all — three falls back to a plain WebGL2
// backend where storage buffers and compute passes aren't available. This is
// the fallback renderer for that case: far fewer blades, scattered once on
// the CPU instead of GPU-clumped, single fixed LOD, no wind simulation field
// (just a cheap per-instance sine sway) — but the same violet palette,
// sun/hemi lighting, ground-light streak and cursor interaction as the real
// thing, so it still reads as "the same scene," just lighter weight.
const BLADE_COUNT = 12_000; // trimmed for mobile GPUs — this path draws all of them unculled every frame, no LOD
const PATCH_RADIUS = 35;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export class FallbackGrass implements GrassLike {
  readonly tile = new THREE.Group();
  private mesh: THREE.Mesh;
  private material: SpriteNodeMaterial;

  constructor() {
    const geometry = new GrassBladeGeometry({ nSegments: 3, bladeHeight: config.BLADE_HEIGHT });
    geometry.instanceCount = BLADE_COUNT;

    // (localOffsetX, localOffsetZ, heightScale, randomSeed) per blade, packed
    // once on the CPU — a Vogel/golden-angle disc keeps the scatter even
    // without the clump/hash system the compute path uses
    const instanceData = new Float32Array(BLADE_COUNT * 4);
    for (let i = 0; i < BLADE_COUNT; i++) {
      const radius = PATCH_RADIUS * Math.sqrt((i + 0.5) / BLADE_COUNT);
      const theta = i * GOLDEN_ANGLE;
      const seed = Math.random();
      instanceData[i * 4 + 0] = Math.cos(theta) * radius;
      instanceData[i * 4 + 1] = Math.sin(theta) * radius;
      instanceData[i * 4 + 2] = THREE.MathUtils.lerp(uniforms.uBladeMinScale.value, uniforms.uBladeMaxScale.value, seed);
      instanceData[i * 4 + 3] = seed;
    }
    this.material = new SpriteNodeMaterial();
    this.material.transparent = false;
    this.material.forceSinglePass = true;

    const instanceAttr = instancedBufferAttribute<"vec4">(instanceData, "vec4", 4, 0);
    const localOffset = instanceAttr.xy;
    const scaleY = instanceAttr.z;
    const seed = instanceAttr.w;

    const bladeUv = uv();
    const bladeHeight = bladeUv.y;
    const bendWeight = bladeHeight.mul(bladeHeight);

    const widthVariation = mix(0.8, 1.2, seed);
    this.material.scaleNode = vec3(uniforms.uBladeWidth.mul(widthVariation), scaleY, 1);

    const spriteAngle = seed.mul(53.3).fract().mul(PI2);
    this.material.rotationNode = seed.mul(2).sub(1).mul(uniforms.uSpriteRotationRandomness);

    // cheap per-instance sine sway instead of a real wind field — no
    // detailed/distant wind blending, just enough motion to not look static
    const swayPhase = gameTime.mul(1.3).add(seed.mul(31.4));
    const swayAmount = sin(swayPhase).mul(uniforms.uWindStrength).mul(0.12).mul(bendWeight);
    const swayDir = vec2(cos(spriteAngle), sin(spriteAngle));

    const worldPositionFlat = vec3(
      localOffset.x.add(uniforms.uPlayerPosition.x),
      uniforms.uPlayerPosition.y,
      localOffset.y.add(uniforms.uPlayerPosition.z)
    );
    const cursorOffset = worldPositionFlat.xz.sub(uCursorPosition);
    const cursorDist = length(cursorOffset).max(0.001);
    const cursorFalloffRaw = float(1).sub(smoothstep(0, uCursorRadius, cursorDist));
    const cursorFalloff = cursorFalloffRaw.mul(cursorFalloffRaw);
    const cursorPush = cursorOffset.div(cursorDist).mul(cursorFalloff).mul(uCursorStrength).mul(bendWeight);

    const bendOffset = swayDir.mul(swayAmount).add(cursorPush);
    // positionNode is LOCAL space (assigned to positionLocal, then the
    // mesh's own transform applies normally) — keep offsets tile-relative
    // and let this.tile.position carry the player-follow translation
    this.material.positionNode = vec3(localOffset.x, 0, localOffset.y).add(vec3(bendOffset.x, 0, bendOffset.y));

    const colorVariation = mix(1, seed, uniforms.uColorVariationStrength);
    const greenColor = mix(uniforms.uBaseColorDark, uniforms.uBaseColor, colorVariation);
    const albedo = mix(greenColor, uniforms.uTipColor, smoothstep(0.25, 1, bladeHeight).mul(uniforms.uColorMixFactor));

    const restingAngle = seed.mul(97.7).fract().mul(PI2);
    const restingNormal = vec3(cos(restingAngle), 0, sin(restingAngle));
    const lightDirection = uSunDir.negate();
    const twoSidedNdotL = restingNormal.dot(lightDirection).abs();
    const diffuseFacing = mix(0.65, twoSidedNdotL, uniforms.uDiffuseContrast);
    const sunDiffuse = uSunRadiance.mul(mix(0.35, 1, diffuseFacing));
    const hemisphereLight = mix(uHemiGroundColor, uHemiSkyColor, 0.5).mul(uHemiIntensity);
    const sceneLighting = hemisphereLight.add(sunDiffuse).mul(uniforms.uLightExposure);

    const groundBrightness = computeGroundBrightness(worldPositionFlat);
    this.material.colorNode = albedo.mul(sceneLighting).mul(groundBrightness);

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.tile.add(this.mesh);
  }

  async init() {
    // nothing to warm up — instance data is already CPU-uploaded at construction
  }

  setViewerPosition(x: number, z: number) {
    this.tile.position.set(x, 0, z);
    uniforms.uPlayerPosition.value.set(x, 0, z);
  }

  update() {
    // wind/lighting uniforms are updated centrally (GameTime.ts, lighting
    // uniforms); nothing per-instance to recompute since there's no compute pass
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
