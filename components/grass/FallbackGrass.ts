import * as THREE from "three/webgpu";
import {
  PI2,
  cameraPosition,
  cos,
  float,
  instancedBufferAttribute,
  length,
  mix,
  mx_noise_float,
  saturate,
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
import {
  uHemiGroundColor,
  uHemiIntensity,
  uHemiSkyColor,
  uSunColor,
  uSunDir,
  uSunDirXZ,
  uSunRadiance,
} from "./lighting";
import { uWindDirection } from "./wind";
import { uCursorPosition, uCursorRadius, uCursorStrength } from "./cursor";
import { computeGroundBrightness } from "./GroundLight";
import type { GrassLike } from "./Grass";

// Devices without the WebGPU `indirect-first-instance` feature (most mobile
// browsers today, even ones with some WebGPU support) can't run Grass.ts's
// compute/indirect-draw pipeline at all — three falls back to a plain WebGL2
// backend where storage buffers and compute passes aren't available. This is
// the fallback renderer for that case: far fewer blades, scattered once on
// the CPU instead of GPU-clumped, single fixed LOD — but the same
// world-space noise wind field, violet palette, sun/hemi/sheen shading,
// ground-light streak and cursor interaction as the real thing, so it still
// reads as "the same scene," just lighter weight.
// Desktop's compute path scatters ~95 blades/unit² near the camera (see
// config.ts: 1.6M blades over a 130x130 tile, full density inside radius 15).
// 160_000 measured ~4x slower (headless software-render proxy) than the
// previous 80_000 once the wind-noise vertex cost was added — given this
// project's actual history of mobile GPU/device-lost crashes, that's not a
// tradeoff worth making blind. 100_000/radius-28 (~40/unit²) keeps most of
// the density win at a materially safer vertex/fragment budget for an
// unculled, no-LOD path that draws every blade every frame.
const TARGET_BLADE_COUNT = 100_000;
const PATCH_RADIUS = 28;
// desktop scatters blades in tight tufts (getBladeLocalOffset in
// GrassBladeData.ts: BLADES_PER_CLUMP blades within CLUMP_LOCAL_RADIUS of a
// clump center) rather than one uniform disc — that clustering is what
// reads as "clumps of grass" instead of an evenly-spaced lawn. Mirror it
// here at the CPU-scatter level: a golden-angle disc of clump centers, each
// holding its own small golden-angle disc of blades.
const BLADES_PER_CLUMP = 8;
const CLUMP_COUNT = Math.round(TARGET_BLADE_COUNT / BLADES_PER_CLUMP);
const BLADE_COUNT = CLUMP_COUNT * BLADES_PER_CLUMP;
const CLUMP_SPACING = Math.sqrt((Math.PI * PATCH_RADIUS * PATCH_RADIUS) / CLUMP_COUNT);
const CLUMP_LOCAL_RADIUS = CLUMP_SPACING * 0.6;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export class FallbackGrass implements GrassLike {
  readonly tile = new THREE.Group();
  private mesh: THREE.Mesh;
  private material: SpriteNodeMaterial;

  constructor() {
    // more segments than the bare minimum (3) so the bend curve reads as a
    // smooth blade instead of a faceted zigzag up close — cheap, since it
    // only adds vertices, not instances
    const geometry = new GrassBladeGeometry({ nSegments: 5, bladeHeight: config.BLADE_HEIGHT });
    geometry.instanceCount = BLADE_COUNT;

    // (localOffsetX, localOffsetZ, heightScale, randomSeed) per blade, packed
    // once on the CPU — two nested golden-angle discs (clump centers, then
    // blades within each clump) instead of one flat disc, so blades read as
    // tufts rather than an evenly-spaced lawn
    const instanceData = new Float32Array(BLADE_COUNT * 4);
    let bladeIndex = 0;
    for (let c = 0; c < CLUMP_COUNT; c++) {
      const clumpRadius = PATCH_RADIUS * Math.sqrt((c + 0.5) / CLUMP_COUNT);
      const clumpTheta = c * GOLDEN_ANGLE;
      const clumpX = Math.cos(clumpTheta) * clumpRadius;
      const clumpZ = Math.sin(clumpTheta) * clumpRadius;
      // rotate each clump's local disc by its own angle so neighboring
      // clumps don't visually align into rows/spokes
      for (let b = 0; b < BLADES_PER_CLUMP; b++, bladeIndex++) {
        const localRadius = CLUMP_LOCAL_RADIUS * Math.sqrt((b + 0.5) / BLADES_PER_CLUMP);
        const localTheta = b * GOLDEN_ANGLE + clumpTheta;
        const seed = Math.random();
        instanceData[bladeIndex * 4 + 0] = clumpX + Math.cos(localTheta) * localRadius;
        instanceData[bladeIndex * 4 + 1] = clumpZ + Math.sin(localTheta) * localRadius;
        instanceData[bladeIndex * 4 + 2] = THREE.MathUtils.lerp(
          uniforms.uBladeMinScale.value,
          uniforms.uBladeMaxScale.value,
          seed
        );
        instanceData[bladeIndex * 4 + 3] = seed;
      }
    }
    this.material = new SpriteNodeMaterial();
    this.material.transparent = false;
    this.material.forceSinglePass = true;

    // instancedBufferAttribute(rawArray, type, stride, offset) silently never
    // marks the node as instanced (three.js only calls .setInstanced() on the
    // mat3/mat4 composite branches internally, not the plain vec2/3/4 path) —
    // so the WebGL2 backend never sets a vertex attribute divisor and reads
    // this data once per VERTEX instead of once per INSTANCE, running off the
    // end of the buffer (invisible/garbage geometry). Passing a real
    // THREE.InstancedBufferAttribute in — the pattern three.js's own
    // SpriteNodeMaterial docs use — takes the constructor's short-circuit
    // path instead, which correctly reads .isInstancedBufferAttribute.
    const instanceAttribute = new THREE.InstancedBufferAttribute(instanceData, 4);
    const instanceAttr = instancedBufferAttribute<"vec4">(instanceAttribute);
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

    const worldPositionFlat = vec3(
      localOffset.x.add(uniforms.uPlayerPosition.x),
      uniforms.uPlayerPosition.y,
      localOffset.y.add(uniforms.uPlayerPosition.z)
    );

    // Spatially-coherent wind field (same idea as GrassCompute.ts's
    // computeDetailedWind: a noise field sampled in world space, scrolled
    // over time along a wind direction) instead of the old per-blade
    // independent sine — that had zero spatial correlation between
    // neighboring blades, so it read as flickering static rather than wind
    // actually moving across the field. Sampling world position means
    // nearby blades share (almost) the same gust value, and the scroll
    // makes that gust travel across the field as a visible wave.
    const windUv = worldPositionFlat.xz.mul(uniforms.uWindUvScale.mul(0.01)).add(uWindDirection.mul(uniforms.uWindSpeed.mul(gameTime)));
    const gustField = mx_noise_float(windUv, 1, 0).mul(0.5).add(0.5);
    const gust = mix(uniforms.uWindLull, 1, gustField);
    // small per-blade flutter layered on top of the coherent gust so
    // neighboring blades aren't perfectly in lockstep, just mostly aligned
    const flutter = sin(gameTime.mul(2.4).add(seed.mul(31.4))).mul(0.35).add(0.65);
    const swayAmount = uniforms.uWindStrength.mul(gust).mul(flutter).mul(0.12).mul(bendWeight);
    // blend each blade's own facing lean with the actual wind direction so
    // sway visibly follows the wind instead of every blade waving on its
    // own random axis
    const swayDir = mix(vec2(cos(spriteAngle), sin(spriteAngle)), uWindDirection, 0.55);

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

    // Same shading model as GrassMaterial.ts (desktop), minus the per-clump
    // proximity AO (no clumps here) — root/edge occlusion, rust/warm tint
    // variation, grazing sheen and sun transmission. Flat albedo*light was
    // the other big reason this path read as "not really grass" even once
    // density was fixed: every blade was the exact same two-tone gradient
    // with no view/light-angle response, so it had no shimmer or depth.
    const edgeDistance = bladeUv.x.mul(2).sub(1).abs();
    const edgeMask = smoothstep(uniforms.uAoRimSmoothness.negate(), uniforms.uAoRimSmoothness, edgeDistance);
    const rootMask = float(1).sub(smoothstep(0.1, 0.85, bladeHeight));
    const occlusion = float(1).sub(edgeMask.mul(rootMask).mul(uniforms.uAoScale).mul(0.25));

    const colorVariation = mix(1, seed, uniforms.uColorVariationStrength);
    const greenColor = mix(uniforms.uBaseColorDark, uniforms.uBaseColor, colorVariation);
    const rustMask = seed.mul(float(1).sub(seed)).mul(4).mul(uniforms.uRustVariationStrength);
    const warmMask = seed.sub(0.6).mul(2.5).clamp().mul(uniforms.uWarmVariationStrength);
    const bladeColor = mix(mix(greenColor, uniforms.uRustColor, rustMask), uniforms.uWarmColor, warmMask);
    const albedo = mix(bladeColor, uniforms.uTipColor, smoothstep(0.25, 1, bladeHeight).mul(uniforms.uColorMixFactor));

    const restingAngle = seed.mul(97.7).fract().mul(PI2);
    const restingNormal = vec3(cos(restingAngle), 0, sin(restingAngle));
    const lightDirection = uSunDir.negate();
    const viewDirection = cameraPosition.sub(worldPositionFlat).normalize();
    const twoSidedNdotL = restingNormal.dot(lightDirection).abs();
    const grazing = float(1).sub(restingNormal.dot(viewDirection).abs().clamp());
    const localBacklight = saturate(restingNormal.dot(lightDirection).negate());
    const viewSunAlignment = viewDirection.xz.normalize().dot(uSunDirXZ).mul(0.5).add(0.5).clamp();

    const diffuseFacing = mix(0.65, twoSidedNdotL, uniforms.uDiffuseContrast);
    const sunDiffuse = uSunRadiance.mul(mix(0.35, 1, diffuseFacing));
    const hemisphereLight = mix(uHemiGroundColor, uHemiSkyColor, 0.5).mul(uHemiIntensity);
    const sceneLighting = hemisphereLight.add(sunDiffuse).mul(uniforms.uLightExposure);

    const grazingSheen = grazing.mul(grazing).mul(mix(0.25, 1, viewSunAlignment)).mul(uniforms.uHighlightStrength);
    const transmission = viewSunAlignment.mul(mix(0.35, 1, localBacklight)).mul(uniforms.uBacklightStrength);
    const detailStrength = smoothstep(0.1, 0.9, bladeHeight);

    const diffuseColor = albedo.mul(occlusion).mul(sceneLighting);
    const sheenColor = uSunRadiance.mul(grazingSheen.mul(detailStrength));
    const transmittedColor = mix(albedo, uSunColor, 0.55).mul(transmission.mul(detailStrength));

    const groundBrightness = computeGroundBrightness(worldPositionFlat);
    this.material.colorNode = diffuseColor.add(sheenColor).add(transmittedColor).mul(groundBrightness);

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
