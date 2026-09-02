import * as THREE from "three/webgpu";
import { config, uniforms } from "./config";
import { GrassBladeGeometry } from "./GrassBladeGeometry";
import { GrassCompute } from "./GrassCompute";
import { GrassMaterial } from "./GrassMaterial";

const UINT32_BYTE_SIZE = Uint32Array.BYTES_PER_ELEMENT;
// exported so createGrassScene.ts can check this up front (same feature
// Grass's constructor gates on) to decide whether to also trim other
// GPU-heavy effects (shadow map size, bloom) for weaker/non-WebGPU devices
export const INDIRECT_FIRST_INSTANCE_FEATURE = "indirect-first-instance";
const INDIRECT_DRAW_BYTE_LENGTH = config.LOD_COUNT * config.INDIRECT_ARGS_STRIDE * UINT32_BYTE_SIZE;

export class UnsupportedGrassRendererError extends Error {}

export type GrassMonitoringStats = {
  rendered: number;
  renderedPerLod: number[];
  segmentsPerLod: number[];
  total: number;
  renderedTriangles: number;
  allocatedTriangles: number;
};

// shape shared with FallbackGrass.ts so createGrassScene.ts/PerformanceMonitor
// can treat either backend identically. getMonitoringStats is optional since
// the fallback has no GPU readback to report.
export interface GrassLike {
  readonly tile: THREE.Object3D;
  init(): Promise<void>;
  setViewerPosition(x: number, z: number): void;
  update(): void;
  dispose(): void;
  getMonitoringStats?(): Promise<GrassMonitoringStats>;
}

// GPU-driven multi-LOD indirect draw: the compute pass sorts every visible
// blade into one of three LOD regions and atomically bumps that LOD's
// instance count, so the CPU never reads anything back — it just issues 3
// indirect draw calls per frame against whatever counts the GPU wrote.
export class Grass implements GrassLike {
  private compute = new GrassCompute();
  private material: GrassMaterial;
  // every LOD mesh rides the same wrapping tile, so only the group moves
  readonly tile = new THREE.Group();
  private viewerDeltaXZ = new THREE.Vector2(0, 0);
  private renderer: THREE.WebGPURenderer;
  private hasInitialized = false;
  private initPromise: Promise<void> | null = null;
  private monitoringReadback = new THREE.ReadbackBuffer(INDIRECT_DRAW_BYTE_LENGTH);

  constructor(renderer: THREE.WebGPURenderer) {
    this.renderer = renderer;

    if (!renderer.hasFeature(INDIRECT_FIRST_INSTANCE_FEATURE)) {
      throw new UnsupportedGrassRendererError(
        `This device/browser does not support the required WebGPU feature "${INDIRECT_FIRST_INSTANCE_FEATURE}".`
      );
    }

    this.material = new GrassMaterial(this.compute);
    config.LOD_DRAW_PROFILES.forEach(({ segments }, lod) => {
      this.tile.add(this.createMesh(segments, lod));
    });
  }

  private createMesh(segments: number, lod: number) {
    const geometry = new GrassBladeGeometry({ nSegments: segments, bladeHeight: config.BLADE_HEIGHT });
    geometry.instanceCount = config.BLADE_COUNT;
    const indirectByteOffset = lod * config.INDIRECT_ARGS_STRIDE * UINT32_BYTE_SIZE;
    geometry.setIndirect(this.compute.indirectDrawAttribute, indirectByteOffset);

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    return mesh;
  }

  async init() {
    if (this.hasInitialized) return;
    if (!this.initPromise) {
      this.initPromise = this.renderer.computeAsync(this.compute.computeInit).then(() => {
        this.hasInitialized = true;
      });
    }
    await this.initPromise;
  }

  // viewerPosition stands in for revo-realms' player position — the ground
  // point the infinite tile wraps around. Call once per frame before update().
  setViewerPosition(x: number, z: number) {
    const dx = x - this.tile.position.x;
    const dz = z - this.tile.position.z;
    this.viewerDeltaXZ.x += dx;
    this.viewerDeltaXZ.y += dz;
    this.tile.position.set(x, 0, z);
    uniforms.uPlayerPosition.value.set(x, 0, z);
  }

  update() {
    if (!this.hasInitialized) return;

    const deltaX = this.viewerDeltaXZ.x;
    const deltaZ = this.viewerDeltaXZ.y;
    this.viewerDeltaXZ.set(0, 0);
    uniforms.uPlayerDeltaXZ.value.set(deltaX, deltaZ);

    this.renderer.compute([this.compute.computeResetInstanceCount, this.compute.computeUpdate]);
  }

  // reads the GPU-written instance counts back to the CPU purely for the dev
  // performance monitor — the render path itself never needs this
  async getMonitoringStats(): Promise<GrassMonitoringStats> {
    const readback = await this.renderer.getArrayBufferAsync(
      this.compute.indirectDrawAttribute,
      this.monitoringReadback
    );
    try {
      const buffer = readback.buffer;
      if (!buffer) throw new Error("[Grass] monitoring readback returned no data");

      const drawArguments = new Uint32Array(buffer);
      const renderedPerLod = config.LOD_DRAW_PROFILES.map(
        (_, lod) => drawArguments[lod * config.INDIRECT_ARGS_STRIDE + config.INSTANCE_COUNT_INDEX]
      );

      let rendered = 0;
      let renderedTriangles = 0;
      let allocatedTriangles = 0;
      for (let lod = 0; lod < config.LOD_DRAW_PROFILES.length; lod++) {
        const trianglesPerBlade = config.LOD_DRAW_PROFILES[lod].indexCount / 3;
        rendered += renderedPerLod[lod];
        renderedTriangles += renderedPerLod[lod] * trianglesPerBlade;
        allocatedTriangles += config.BLADE_COUNT * trianglesPerBlade;
      }

      return {
        rendered,
        renderedPerLod,
        segmentsPerLod: config.LOD_DRAW_PROFILES.map(({ segments }) => segments),
        total: config.BLADE_COUNT,
        renderedTriangles,
        allocatedTriangles,
      };
    } finally {
      readback.release();
    }
  }

  dispose() {
    this.tile.children.forEach((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
    });
    this.material.dispose();
    this.monitoringReadback.dispose();
  }
}
