import type { Pane } from "tweakpane";
import { srgbColorTarget } from "./TweakpaneColor";
import type { GrassConfig, GrassUniforms } from "./config";
import { uCursorRadius, uCursorStrength } from "./cursor";
import type { Player } from "./Player";
import { playerConfig } from "./playerConfig";
import { playerCameraConfig } from "./PlayerCamera";
import { groundLightConfig } from "./GroundLight";
import type BloomNode from "three/addons/tsl/display/BloomNode.js";
import type { DirectionalLight, HemisphereLight, WebGPURenderer } from "three/webgpu";

// Dev-only Tweakpane config controller. Ported from revo-realms' DebugManager +
// Grass/debug.ts, trimmed to what this port actually has (no terrain-driven
// trail-crush, no LOD debug-color overlay — those needed a player character).
export async function createDevPanel(): Promise<Pane | null> {
  if (process.env.NODE_ENV !== "development") return null;
  const { Pane } = await import("tweakpane");
  return new Pane({ title: "Norma Grass" });
}

export const debugGrass = (pane: Pane, uniforms: GrassUniforms, config: GrassConfig) => {
  const folder = pane.addFolder({ title: "🌱 Grass", expanded: false });

  const color = folder.addFolder({ title: "Color" });
  color.addBinding(srgbColorTarget(uniforms.uTipColor.value), "value", {
    label: "Tip",
    view: "color",
    color: { type: "float" },
  });
  color.addBinding(srgbColorTarget(uniforms.uBaseColor.value), "value", {
    label: "Base",
    view: "color",
    color: { type: "float" },
  });
  color.addBinding(srgbColorTarget(uniforms.uBaseColorDark.value), "value", {
    label: "Base dark",
    view: "color",
    color: { type: "float" },
  });
  color.addBinding(srgbColorTarget(uniforms.uWarmColor.value), "value", {
    label: "Highlight",
    view: "color",
    color: { type: "float" },
  });
  color.addBinding(srgbColorTarget(uniforms.uRustColor.value), "value", {
    label: "Accent",
    view: "color",
    color: { type: "float" },
  });
  color.addBinding(uniforms.uColorMixFactor, "value", { label: "Mix factor", min: 0, max: 1, step: 0.01 });
  color.addBinding(uniforms.uColorVariationStrength, "value", { label: "Base variation", min: 0, max: 1, step: 0.01 });
  color.addBinding(uniforms.uWarmVariationStrength, "value", { label: "Highlight variation", min: 0, max: 1, step: 0.01 });
  color.addBinding(uniforms.uRustVariationStrength, "value", { label: "Accent variation", min: 0, max: 1, step: 0.01 });

  const lighting = folder.addFolder({ title: "Lighting" });
  lighting.addBinding(uniforms.uDiffuseContrast, "value", { label: "Diffuse contrast", min: 0, max: 1, step: 0.01 });
  lighting.addBinding(uniforms.uLightExposure, "value", { label: "Exposure", min: 0, max: 3, step: 0.01 });
  lighting.addBinding(uniforms.uHighlightStrength, "value", { label: "Highlight strength", min: 0, max: 0.5, step: 0.005 });
  lighting.addBinding(uniforms.uBacklightStrength, "value", { label: "Backlight strength", min: 0, max: 1, step: 0.01 });
  lighting.addBinding(uniforms.uRootSkyVisibility, "value", { label: "Root sky visibility", min: 0, max: 1, step: 0.01 });

  // brightness falloff itself now lives in the 🔦 Ground light folder
  // (computeGroundBrightness in GroundLight.ts, shared with grass and ground)

  const ao = folder.addFolder({ title: "AO" });
  ao.addBinding(uniforms.uAoScale, "value", { label: "Scale", min: 0, max: 5, step: 0.01 });
  ao.addBinding(uniforms.uAoRimSmoothness, "value", { label: "Rim smoothness", min: 0, max: 5, step: 0.01 });
  ao.addBinding(uniforms.uAoRadius, "value", { label: "Radius", min: 0, max: config.TILE_HALF_SIZE, step: 0.1 }).on(
    "change",
    ({ value }) => {
      uniforms.uAoRadiusSquared.value = value * value;
    }
  );

  const wind = folder.addFolder({ title: "Wind" });
  wind.addBinding(uniforms.uWindStrength, "value", { label: "Strength", min: 0, max: Math.PI, step: 0.01 });
  wind.addBinding(uniforms.uWindSpeed, "value", { label: "Speed", min: 0, max: 1, step: 0.01 });
  wind.addBinding(uniforms.uWindUvScale, "value", { label: "UV scale", min: 0, max: 10, step: 0.01 });
  wind.addBinding(uniforms.uAmbientSwayStrength, "value", { label: "Ambient sway", min: 0, max: 0.15, step: 0.001 });
  wind.addBinding(uniforms.uWindLull, "value", { label: "Calm floor", min: 0, max: 1, step: 0.01 });
  wind.addBinding(uniforms.uWindEddyStrength, "value", { label: "Eddy strength", min: 0, max: 1.5, step: 0.01 });
  wind.addBinding(uniforms.uWindGustCoverage, "value", { label: "Gust coverage", min: 0, max: 1, step: 0.01 });
  wind.addBinding(uniforms.uDetailedWindRadius, "value", {
    label: "Detailed radius",
    min: 0,
    max: config.TILE_HALF_SIZE * Math.SQRT2,
    step: 1,
  });
  wind.addBinding(uniforms.uWindCurveP1, "value", { label: "Wind curve short", min: 0, max: 1, step: 0.01 });
  wind.addBinding(uniforms.uWindCurveP2, "value", { label: "Wind curve tall", min: 0, max: 1, step: 0.01 });
  wind.addBinding(uniforms.uBendDropStrength, "value", { label: "Bend drop", min: 0, max: 4, step: 0.05 });
  wind.addBinding(uniforms.uBendControlPoint, "value", { label: "Bend control point", min: 0, max: 1, step: 0.01 });

  const density = folder.addFolder({ title: "Density" });
  density.addBinding(uniforms.uDensityFalloffRadius, "value", {
    label: "Falloff radius",
    min: 0,
    max: config.TILE_SIZE,
    step: 0.1,
  });
  density.addBinding(uniforms.uFarDensity, "value", { label: "Far density", min: 0, max: 1, step: 0.01 });
  density.addBinding(uniforms.uStochasticHysteresis, "value", {
    label: "Stochastic hysteresis",
    min: 0,
    max: 0.5,
    step: 0.01,
  });

  const culling = folder.addFolder({ title: "Culling" });
  culling.addBinding(uniforms.uCullPadNDCX, "value", { label: "Horizontal pad", min: 0, max: 2, step: 0.01 });
  culling.addBinding(uniforms.uCullPadNDCYNear, "value", { label: "Near vertical pad", min: 0, max: 2, step: 0.01 });
  culling.addBinding(uniforms.uCullPadNDCYFar, "value", { label: "Far vertical pad", min: 0, max: 2, step: 0.01 });
  culling.addBinding(uniforms.uClumpBoundMultiplier, "value", { label: "Clump bound", min: 0.5, max: 2, step: 0.05 });

  const width = folder.addFolder({ title: "Width" });
  width.addBinding(uniforms.uBladeWidth, "value", { label: "Blade width", min: 0.01, max: 0.3, step: 0.005 });
  width.addBinding(uniforms.uWidthFarGain, "value", { label: "Far width gain", min: 1, max: 10, step: 0.05 });
  width
    .addBinding(uniforms.uWidthNearRadius, "value", { label: "Gain start radius", min: 0, max: config.TILE_HALF_SIZE, step: 0.5 })
    .on("change", ({ value }) => {
      uniforms.uWidthNearRadiusSquared.value = value * value;
    });
  width
    .addBinding(uniforms.uWidthFarRadius, "value", { label: "Gain full radius", min: 0, max: config.TILE_HALF_SIZE, step: 0.5 })
    .on("change", ({ value }) => {
      uniforms.uWidthFarRadiusSquared.value = value * value;
    });

  const lod = folder.addFolder({ title: "LOD" });
  lod
    .addBinding(uniforms.uLod0Radius, "value", { label: "Near radius", min: 0, max: config.TILE_HALF_SIZE, step: 0.5 })
    .on("change", ({ value }) => {
      uniforms.uLod0RadiusSquared.value = value * value;
    });
  lod
    .addBinding(uniforms.uLod1Radius, "value", { label: "Mid radius", min: 0, max: config.TILE_HALF_SIZE, step: 0.5 })
    .on("change", ({ value }) => {
      uniforms.uLod1RadiusSquared.value = value * value;
    });

  const general = folder.addFolder({ title: "General" });
  general.addBinding(uniforms.uBaseBending, "value", { label: "Base bend", min: -Math.PI * 2, max: Math.PI * 2, step: 0.01 });
  general.addBinding(uniforms.uSpriteRotationRandomness, "value", { label: "Sprite rotation", min: 0, max: Math.PI * 0.5, step: 0.01 });
  general.addBinding(uniforms.uBladeMinScale, "value", { label: "Min scale", min: 0, max: 5, step: 0.01 });
  general.addBinding(uniforms.uBladeMaxScale, "value", { label: "Max scale", min: 0, max: 5, step: 0.01 });
};

// our own addition (source has no cursor interaction) — same panel pattern
export const debugInteraction = (pane: Pane) => {
  const folder = pane.addFolder({ title: "🖱️ Cursor", expanded: false });
  folder.addBinding(uCursorRadius, "value", { label: "Push radius", min: 0, max: 15, step: 0.1 });
  folder.addBinding(uCursorStrength, "value", { label: "Push strength", min: 0, max: 5, step: 0.05 });
};

// our own addition (source has no player character) — position/size/facing
// bind directly to the live instance, walk feel comes from playerConfig.ts
export const debugPlayer = (pane: Pane, player: Player) => {
  const folder = pane.addFolder({ title: "🚶 Player", expanded: false });

  const position = folder.addFolder({ title: "Position" });
  position.addBinding(player.root.position, "x", { min: -100, max: 100, step: 0.5 });
  position.addBinding(player.root.position, "y", { min: -5, max: 5, step: 0.1, label: "Y (offset)" });
  position.addBinding(player.root.position, "z", { min: -100, max: 100, step: 0.5 });
  position.addButton({ title: "Reset to origin" }).on("click", () => {
    player.root.position.x = 0;
    player.root.position.z = 0;
  });

  // uniform-scale proxy, same pattern as srgbColorTarget — keeps x/y/z locked
  // together instead of exposing three separate scale sliders
  const sizeTarget = {
    get value() {
      return player.root.scale.x;
    },
    set value(v: number) {
      player.root.scale.setScalar(v);
    },
  };
  folder.addBinding(sizeTarget, "value", { min: 0.1, max: 10, step: 0.01, label: "Size" });

  const walk = folder.addFolder({ title: "Walk" });
  walk.addBinding(playerConfig, "SCROLL_TO_VELOCITY", { min: 0.001, max: 0.05, step: 0.001, label: "Scroll sensitivity" });
  walk.addBinding(playerConfig, "MAX_WALK_SPEED", { min: 0.5, max: 15, step: 0.1, label: "Max speed" });
  walk.addBinding(playerConfig, "BASE_WALK_SPEED", { min: 0.5, max: 10, step: 0.1, label: "Base speed (anim pace)" });
  walk.addBinding(playerConfig, "VELOCITY_DECAY_PER_SECOND", { min: 0.5, max: 15, step: 0.1, label: "Ease-to-idle rate" });

  folder.addBinding(player.root.rotation, "y", { min: -Math.PI, max: Math.PI, step: 0.01, label: "Facing (yaw)" });
};

// our own addition — same OFFSET/follow-speed fields as revo-realms'
// PlayerCamera.ts, exposed live instead of only being code constants
export const debugPlayerCamera = (pane: Pane) => {
  const folder = pane.addFolder({ title: "🎥 Camera", expanded: false });
  folder.addBinding(playerCameraConfig.OFFSET, "x", { min: -30, max: 30, step: 0.5, label: "Offset X" });
  folder.addBinding(playerCameraConfig.OFFSET, "y", { min: 0, max: 50, step: 0.5, label: "Height" });
  folder.addBinding(playerCameraConfig.OFFSET, "z", { min: 0, max: 60, step: 0.5, label: "Distance" });
  folder.addBinding(playerCameraConfig, "TARGET_HEIGHT_IN_METERS", { min: -2, max: 5, step: 0.1, label: "Look-at height" });
  folder.addBinding(playerCameraConfig, "POSITION_FOLLOW_SPEED_IN_INVERSE_SECONDS", {
    min: 1,
    max: 40,
    step: 0.5,
    label: "Position follow",
  });
  folder.addBinding(playerCameraConfig, "TARGET_FOLLOW_SPEED_IN_INVERSE_SECONDS", {
    min: 1,
    max: 50,
    step: 0.5,
    label: "Target follow",
  });
  folder.addBinding(playerCameraConfig, "ROTATION_FOLLOW_SPEED_IN_INVERSE_SECONDS", {
    min: 1,
    max: 40,
    step: 0.5,
    label: "Rotation follow",
  });
};

// our own addition — an elongated, soft-edged light streak on the ground
// centered on the player (GroundLight.ts, computeGroundBrightness) —
// art-directable (length/width/softness), not derived from real 3D light
// geometry (a visible beam mesh in the air was tried and removed — it read
// as too small/rigid to match the intended photographic reference look).
export const debugGroundLight = (pane: Pane) => {
  const folder = pane.addFolder({ title: "🔦 Ground light", expanded: false });

  folder.addBinding(groundLightConfig.LENGTH, "value", { min: 5, max: 200, step: 1, label: "Length" });
  folder.addBinding(groundLightConfig.WIDTH, "value", { min: 1, max: 60, step: 0.5, label: "Width" });
  folder.addBinding(groundLightConfig.SOFTNESS, "value", { min: 0.01, max: 1, step: 0.01, label: "Edge softness" });
  folder.addBinding(groundLightConfig.EDGE_NOISE_STRENGTH, "value", {
    min: 0,
    max: 0.5,
    step: 0.01,
    label: "Edge noise",
  });
  folder.addBinding(groundLightConfig.MIN_BRIGHTNESS, "value", { min: 0, max: 1, step: 0.01, label: "Min brightness" });
};

// our own addition — post-processing bloom (createGrassScene.ts) for the
// "premium" glow on lit grass/streak areas. onToggle actually swaps the
// render pipeline's output node — pushing strength to 0 still runs every
// blur/downsample pass, so it's useless for isolating bloom's real GPU cost
export const debugBloom = (pane: Pane, bloomPass: BloomNode, onToggle: (enabled: boolean) => void) => {
  const folder = pane.addFolder({ title: "✨ Bloom", expanded: false });
  folder
    .addBinding({ enabled: true }, "enabled", { label: "Enabled" })
    .on("change", ({ value }) => onToggle(value));
  folder.addBinding(bloomPass.strength, "value", { min: 0, max: 3, step: 0.05, label: "Strength" });
  folder.addBinding(bloomPass.radius, "value", { min: 0, max: 1, step: 0.01, label: "Radius" });
  folder.addBinding(bloomPass.threshold, "value", { min: 0, max: 1, step: 0.01, label: "Threshold" });
};

// our own addition — the real THREE.Light objects added so the player (and
// his shadow) actually render lit (createGrassScene.ts); grass/ground still
// use the separate fake shader lighting, unaffected by these
export const debugSceneLighting = (
  pane: Pane,
  sunLight: DirectionalLight,
  hemiLight: HemisphereLight,
  renderer: WebGPURenderer
) => {
  const folder = pane.addFolder({ title: "💡 Player lighting", expanded: false });
  folder.addBinding(sunLight, "intensity", { min: 0, max: 10, step: 0.1, label: "Sun intensity" });
  folder.addBinding(hemiLight, "intensity", { min: 0, max: 5, step: 0.05, label: "Ambient intensity" });
  folder.addBinding(sunLight.shadow, "bias", { min: -0.01, max: 0.01, step: 0.0001, label: "Shadow bias" });
  folder
    .addBinding({ enabled: sunLight.castShadow }, "enabled", { label: "Shadows enabled" })
    .on("change", ({ value }) => {
      sunLight.castShadow = value;
    });
  // without this, real-light output just clips straight to white past 1.0 —
  // the flat, blown-out look. ACES rolls highlights off instead of clipping.
  folder.addBinding(renderer, "toneMappingExposure", { min: 0.1, max: 3, step: 0.05, label: "Exposure" });
};
