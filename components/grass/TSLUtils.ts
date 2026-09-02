import { Fn, float, pow, floor, mod, sub, clamp, max, round, step, EPSILON } from "three/tsl";
import type { Node } from "three/webgpu";

type FloatNode = Node<"float">;
type Vec4Node = Node<"vec4">;

type PackF32Args = [
  dest: FloatNode,
  offset: FloatNode,
  bits: FloatNode,
  value: FloatNode,
  lsb: FloatNode,
  bias: FloatNode,
];
type UnpackF32Args = [src: FloatNode, offset: FloatNode, bits: FloatNode, lsb: FloatNode, bias: FloatNode];
type PackUnitArgs = [dest: FloatNode, offset: FloatNode, bits: FloatNode, value: FloatNode];
type UnpackUnitArgs = [src: FloatNode, offset: FloatNode, bits: FloatNode];
type PackFlagArgs = [dest: FloatNode, offset: FloatNode, value: FloatNode];
type UnpackFlagArgs = [src: FloatNode, offset: FloatNode];
type PackUnitsArgs = [
  dest: FloatNode,
  offset: FloatNode,
  bits: FloatNode,
  value: FloatNode,
  minV: FloatNode,
  maxV: FloatNode,
];
type UnpackUnitsArgs = [src: FloatNode, offset: FloatNode, bits: FloatNode, minV: FloatNode, maxV: FloatNode];
type FrustumVisibilityArgs = [
  clipPosition: Vec4Node,
  fX: FloatNode,
  fY: FloatNode,
  radius: FloatNode,
  padNdcX: FloatNode,
  padNdcYNear: FloatNode,
  padNdcYFar: FloatNode,
];

// Bit-packing helpers ported from revo-realms' TSLUtils — several small fields
// (scale, visibility flags, orientation, wind bend) are packed into a single
// float per instance so a clump/blade's whole state fits in one vec4/vec2
// storage-buffer slot instead of several.
export class TSLUtils {
  private static packF32 = Fn<PackF32Args, FloatNode>(([dest, offset, bits, value, lsb, bias]) => {
    const levels = sub(pow(2, bits), 1);
    const qRaw = sub(value, bias).div(max(lsb, EPSILON));
    const q = clamp(round(qRaw), 0, levels);

    const base = pow(2, offset);
    const span = pow(2, bits);
    const slot = floor(dest.div(base));
    const old = mod(slot, span).mul(base);

    return dest.sub(old).add(q.mul(base));
  });

  private static unpackF32 = Fn<UnpackF32Args, FloatNode>(([src, offset, bits, lsb, bias]) => {
    const base = pow(2, offset);
    const span = pow(2, bits);
    const slot = floor(src.div(base));
    const q = mod(slot, span);
    return q.mul(lsb).add(bias);
  });

  static packUnit = Fn<PackUnitArgs, FloatNode>(([dest, offset, bits, value]) => {
    const lsb = float(1).div(sub(pow(2, bits), 1));
    return this.packF32(dest, offset, bits, value, lsb, float(0));
  });

  static unpackUnit = Fn<UnpackUnitArgs, FloatNode>(([src, offset, bits]) => {
    const lsb = float(1).div(sub(pow(2, bits), 1));
    return this.unpackF32(src, offset, bits, lsb, float(0));
  });

  static packFlag = Fn<PackFlagArgs, FloatNode>(([dest, offset, value]) =>
    this.packF32(dest, offset, float(1), value, float(1), float(0))
  );

  static unpackFlag = Fn<UnpackFlagArgs, FloatNode>(([src, offset]) =>
    this.unpackF32(src, offset, float(1), float(1), float(0))
  );

  static packUnits = Fn<PackUnitsArgs, FloatNode>(([dest, offset, bits, value, minV, maxV]) => {
    const levels = sub(pow(2, bits), 1);
    const lsb = maxV.sub(minV).div(levels);
    return this.packF32(dest, offset, bits, value, lsb, minV);
  });

  static unpackUnits = Fn<UnpackUnitsArgs, FloatNode>(([src, offset, bits, minV, maxV]) => {
    const lsb = maxV.sub(minV).div(sub(pow(2, bits), 1));
    return this.unpackF32(src, offset, bits, lsb, minV);
  });

  // padded NDC frustum test: pads the clip-space bounds by an instance's
  // world-space bounding radius (projected via the focal terms fX/fY),
  // so instances near the screen edge aren't popped before they're fully offscreen.
  static computeFrustumVisibility = Fn<FrustumVisibilityArgs, FloatNode>(
    ([clipPosition, fX, fY, radius, padNdcX, padNdcYNear, padNdcYFar]) => {
      const one = float(1);
      const ndc = clipPosition.xyz.mul(one.div(clipPosition.w));
      const eyeDepthAbs = clipPosition.w.abs().max(EPSILON);
      const radiusNdcX = fX.mul(radius).div(eyeDepthAbs).add(padNdcX);
      const radiusNdcY = fY.mul(radius).div(eyeDepthAbs);
      const radiusNdcYNear = radiusNdcY.add(padNdcYNear);
      const radiusNdcYFar = radiusNdcY.sub(padNdcYFar);
      const isVisibleX = step(one.negate().sub(radiusNdcX), ndc.x).mul(step(ndc.x, one.add(radiusNdcX)));
      const isVisibleY = step(one.negate().sub(radiusNdcYNear), ndc.y).mul(step(ndc.y.add(radiusNdcYFar), one));
      const isVisibleZ = step(-1, ndc.z).mul(step(ndc.z, 1));
      return isVisibleX.mul(isVisibleY).mul(isVisibleZ);
    }
  );
}
