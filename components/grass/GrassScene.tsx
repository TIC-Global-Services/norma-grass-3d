"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { createGrassScene, type GrassSceneHandle } from "./createGrassScene";
import { playerConfig } from "./playerConfig";

export default function GrassScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let renderer: THREE.WebGPURenderer | null = null;
    let scene: GrassSceneHandle | null = null;

    const resize = () => scene?.onResize();

    (async () => {
      try {
        // no forceWebGL — WebGPURenderer probes for real WebGPU first and
        // silently falls back to a WebGL2 backend when unavailable (nearly
        // every mobile browser today). createGrassScene() then separately
        // picks Grass vs. FallbackGrass depending on what that backend
        // supports. This try/catch exists so that if init() (or scene setup)
        // fails for any OTHER reason — e.g. no WebGL2 context at all — the
        // user gets a visible message instead of a silently blank canvas,
        // which is what a device with no console access just looks like.
        renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
        await renderer.init();
        if (cancelled) {
          renderer.dispose();
          return;
        }

        scene = await createGrassScene(renderer, canvas);
        if (cancelled) {
          scene.dispose();
          return;
        }

        scene.start();
        window.addEventListener("resize", resize);
      } catch (err) {
        console.error("[GrassScene] failed to start:", err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("resize", resize);
      scene?.dispose();
      renderer?.dispose();
    };
  }, []);

  return (
    // pin: the hero (canvas) sticks to the viewport for SCROLL_INTRO_THRESHOLD_PX
    // of extra scroll height, then releases and scrolls away normally — and
    // re-pins automatically if the user scrolls back up, since that's just
    // how position:sticky works. createGrassScene.ts assumes this sits at
    // document top (scrollY == progress through this pin) — keep it first on the page.
    <div style={{ height: `calc(100vh + ${playerConfig.SCROLL_INTRO_THRESHOLD_PX}px)` }} className="relative w-full">
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {/* fades the canvas into the next section's flat #050208 background
            instead of cutting hard at the pin's bottom edge */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[35vh]"
          style={{ background: "linear-gradient(to bottom, transparent, #050208 85%)" }}
        />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-8 text-center text-white">
            <p className="max-w-md text-sm">This experience couldn&apos;t start on this device/browser. {error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
