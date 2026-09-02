import { Color, Vector2, Vector3 } from "three";
import { uniform } from "three/tsl";

const getBladeIndexCount = (segments: number) => Math.max(0, segments - 1) * 6 + 3;

const getDrawProfile = (segments: number) => ({
  segments,
  indexCount: getBladeIndexCount(segments),
});

const getConfig = () => {
  const BLADE_WIDTH = 0.025;
  const BLADE_HEIGHT = 1.75;
  const TILE_SIZE = 130;
  // near to far, one indirect draw per entry
  const LOD_DRAW_PROFILES = [8, 4, 2].map(getDrawProfile);
  const BLADES_PER_CLUMP = 8;
  const CLUMPS_PER_SIDE = 448;
  const CLUMP_COUNT = CLUMPS_PER_SIDE * CLUMPS_PER_SIDE;
  const BLADE_COUNT = CLUMP_COUNT * BLADES_PER_CLUMP;
  const CLUMP_SPACING = TILE_SIZE / CLUMPS_PER_SIDE;
  const CLUMP_LOCAL_RADIUS = CLUMP_SPACING * 0.6;
  const DETAILED_WIND_TRANSITION_WIDTH = 5;

  return {
    LOD_DRAW_PROFILES,
    LOD_COUNT: LOD_DRAW_PROFILES.length,
    // indexCount, instanceCount, firstIndex, baseVertex, firstInstance
    INDIRECT_ARGS_STRIDE: 5,
    INDEX_COUNT_INDEX: 0,
    INSTANCE_COUNT_INDEX: 1,
    FIRST_INSTANCE_INDEX: 4,
    BLADE_WIDTH,
    BLADE_HEIGHT,
    BLADE_BOUNDING_SPHERE_RADIUS: BLADE_HEIGHT,
    TILE_SIZE,
    TILE_HALF_SIZE: TILE_SIZE / 2,
    BLADES_PER_CLUMP,
    CLUMPS_PER_SIDE,
    CLUMP_COUNT,
    BLADE_COUNT,
    CLUMP_SPACING,
    CLUMP_LOCAL_RADIUS,
    WORKGROUP_SIZE: 64,
    DETAILED_WIND_TRANSITION_WIDTH,
  };
};

export const config = getConfig();
export type GrassConfig = typeof config;

export const uniforms = {
  // Culling — kept tight to what the camera actually sees; the old, much
  // more generous margins (0.35 / 0.75 / 0.2) were rendering way more grass
  // than was ever on screen and tanking fps
  uCullPadNDCX: uniform(0.15),
  uCullPadNDCYNear: uniform(-0.1),
  uCullPadNDCYFar: uniform(0.1),
  uClumpBoundMultiplier: uniform(1),

  // LOD
  uLod0Radius: uniform(15),
  uLod0RadiusSquared: uniform(15 * 15),
  uLod1Radius: uniform(35),
  uLod1RadiusSquared: uniform(35 * 35),

  // Viewer (stands in for the source's player position/delta)
  uPlayerPosition: uniform(new Vector3(0, 0, 0)),
  uPlayerDeltaXZ: uniform(new Vector2(0, 0)),

  // Width
  uBladeWidth: uniform(config.BLADE_WIDTH),
  uWidthFarGain: uniform(3),
  uWidthNearRadius: uniform(15),
  uWidthNearRadiusSquared: uniform(15 * 15),
  uWidthFarRadius: uniform(35),
  uWidthFarRadiusSquared: uniform(35 * 35),

  // Scale
  uBladeMinScale: uniform(1.25),
  uBladeMaxScale: uniform(2.65),

  // Wind
  uWindStrength: uniform(1.8),
  uWindSpeed: uniform(1),
  uWindUvScale: uniform(5),
  uAmbientSwayStrength: uniform(0.090),
  uWindLull: uniform(0.10),
  uWindEddyStrength: uniform(0.15),
  uWindGustCoverage: uniform(0.6),
  uDetailedWindRadius: uniform(60),
  uWindCurveP1: uniform(0.00),
  uWindCurveP2: uniform(0.25),
  uBendDropStrength: uniform(0.85),
  uBendControlPoint: uniform(0.20),

  // Color — deep violet base, brighter lavender tips, matching the moody
  // purple reference (no green/warm-rust tones)
  uBaseColorDark: uniform(new Color(0.043, 0.024, 0.07).convertSRGBToLinear()),
  uBaseColor: uniform(new Color(0.227, 0.122, 0.322).convertSRGBToLinear()),
  uTipColor: uniform(new Color(0.604, 0.455, 0.788).convertSRGBToLinear()),
  uWarmColor: uniform(new Color(0.788, 0.682, 0.91).convertSRGBToLinear()),
  uRustColor: uniform(new Color(0.29, 0.102, 0.31).convertSRGBToLinear()),
  uColorMixFactor: uniform(1.00),
  uColorVariationStrength: uniform(0.60),
  uWarmVariationStrength: uniform(0.90),
  uRustVariationStrength: uniform(0.70),

  // AO
  uAoScale: uniform(1.5),
  uAoRimSmoothness: uniform(5),
  uAoRadius: uniform(65),
  uAoRadiusSquared: uniform(65 * 65),

  // Lighting
  uDiffuseContrast: uniform(0.50),
  uLightExposure: uniform(3),
  uHighlightStrength: uniform(0.5),
  uBacklightStrength: uniform(1.00),
  uRootSkyVisibility: uniform(1.00),

  // Stochastic keep
  uFullDensityRadius: uniform(18),
  uDensityFalloffRadius: uniform(45),
  uFarDensity: uniform(0.20),
  uProjectedHeightMin: uniform(0.04),
  uProjectedHeightFull: uniform(0.11),
  uStochasticHysteresis: uniform(0.11),

  // Rotation
  uBaseBending: uniform(3.5),
  uSpriteRotationRandomness: uniform(0.55),
};

export type GrassUniforms = typeof uniforms;
