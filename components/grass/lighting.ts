import { Color, Vector2, Vector3 } from "three";
import { uniform } from "three/tsl";

// Static sun/hemisphere lighting, retuned cool-violet to match the moody
// purple reference instead of revo-realms' original warm-sunset preset.
const LIGHT_POSITION_OFFSET = new Vector3(10, 10, 10);
const directionalColor = new Color(0.75, 0.65, 0.95).convertSRGBToLinear();
const directionalIntensity = 0.5;
const hemiSkyColor = new Color(0.25, 0.12, 0.4).convertSRGBToLinear();
const hemiGroundColor = new Color(0.04, 0.02, 0.06).convertSRGBToLinear();
const hemiIntensity = 0.4;

const sunDirection = LIGHT_POSITION_OFFSET.clone().normalize().negate();
const sunDirectionXZ = new Vector2(sunDirection.x, sunDirection.z).normalize();

export const uSunDir = uniform(sunDirection);
export const uSunDirXZ = uniform(sunDirectionXZ);
export const uSunRadiance = uniform(directionalColor.clone().multiplyScalar(directionalIntensity));
export const uSunColor = uniform(directionalColor.clone());
export const uHemiSkyColor = uniform(hemiSkyColor.clone());
export const uHemiGroundColor = uniform(hemiGroundColor.clone());
export const uHemiIntensity = uniform(hemiIntensity);
