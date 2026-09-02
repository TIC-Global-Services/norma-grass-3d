import type { Pane, FolderApi } from "tweakpane";
import type * as THREE from "three/webgpu";
import type { GrassLike } from "./Grass";

const SNAPSHOT_INTERVAL_MS = 1000;

// Lighter analog of revo-realms' MonitoringManager — that one wraps the
// `agrimensor` WebGPU device profiler plus a physics scheduler we don't have.
// This uses three.js's built-in renderer.info counters and the same
// indirect-draw-argument readback Grass.getMonitoringStats() exposes.
type MonitorStats = {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  grassTriangles: number;
  computeCalls: number;
  grassRendered: number;
  grassTotal: number;
  grassPerLod: string;
};

export class PerformanceMonitor {
  private stats: MonitorStats = {
    fps: 0,
    frameMs: 0,
    drawCalls: 0,
    triangles: 0,
    grassTriangles: 0,
    computeCalls: 0,
    grassRendered: 0,
    grassTotal: 0,
    grassPerLod: "",
  };
  private folder: FolderApi;
  private frameCount = 0;
  private frameTimeSumMs = 0;
  private lastSnapshotAt = performance.now();
  private isGrassStatsPending = false;
  private renderer: THREE.WebGPURenderer;
  private grass: GrassLike;

  constructor(pane: Pane, renderer: THREE.WebGPURenderer, grass: GrassLike) {
    this.renderer = renderer;
    this.grass = grass;

    this.folder = pane.addFolder({ title: "📊 Performance", expanded: true });
    this.folder.addBinding(this.stats, "fps", {
      readonly: true,
      view: "graph",
      min: 0,
      max: 144,
      label: "FPS",
    });
    this.folder.addBinding(this.stats, "frameMs", { readonly: true, label: "Frame ms" });
    this.folder.addBinding(this.stats, "drawCalls", { readonly: true, label: "Draw calls" });
    this.folder.addBinding(this.stats, "triangles", {
      readonly: true,
      label: "Triangles (raw, misleading)",
    });
    this.folder.addBinding(this.stats, "grassTriangles", {
      readonly: true,
      label: "Grass triangles (real)",
    });
    this.folder.addBinding(this.stats, "computeCalls", { readonly: true, label: "Compute calls" });
    this.folder.addBinding(this.stats, "grassRendered", { readonly: true, label: "Grass rendered" });
    this.folder.addBinding(this.stats, "grassTotal", { readonly: true, label: "Grass allocated" });
    this.folder.addBinding(this.stats, "grassPerLod", { readonly: true, label: "Grass per LOD" });
  }

  // call once per frame from the animate loop
  sample(deltaSeconds: number) {
    this.frameCount++;
    this.frameTimeSumMs += deltaSeconds * 1000;

    const now = performance.now();
    const elapsedMs = now - this.lastSnapshotAt;
    if (elapsedMs < SNAPSHOT_INTERVAL_MS) return;

    this.stats.fps = this.frameCount / (elapsedMs / 1000);
    this.stats.frameMs = this.frameTimeSumMs / this.frameCount;
    this.stats.drawCalls = this.renderer.info.render.drawCalls;
    // WebGPU indirect draws never report their real GPU-written instance
    // count back to the CPU, so this uses geometry.instanceCount (the static
    // upper bound, config.BLADE_COUNT) for every LOD mesh regardless of how
    // many actually drew — always far higher than reality. grassTriangles
    // below (from the indirect buffer readback) is the real number.
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.computeCalls = this.renderer.info.compute.frameCalls;

    this.frameCount = 0;
    this.frameTimeSumMs = 0;
    this.lastSnapshotAt = now;

    void this.refreshGrassStats();
  }

  private async refreshGrassStats() {
    if (this.isGrassStatsPending || !this.grass.getMonitoringStats) return;
    this.isGrassStatsPending = true;
    try {
      const grassStats = await this.grass.getMonitoringStats();
      this.stats.grassRendered = grassStats.rendered;
      this.stats.grassTotal = grassStats.total;
      this.stats.grassTriangles = grassStats.renderedTriangles;
      this.stats.grassPerLod = grassStats.renderedPerLod.join(" / ");
    } catch (error) {
      console.error("[PerformanceMonitor] grass stats failed:", error);
    } finally {
      this.isGrassStatsPending = false;
    }
  }

  dispose() {
    this.folder.dispose();
  }
}
