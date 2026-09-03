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
        // React Strict Mode's dev-only mount→cleanup→mount runs all THREE
        // synchronously in one tick, with no await in between. Without this
        // yield, `new THREE.WebGPURenderer()` + `renderer.init()` below would
        // fire synchronously during the FIRST mount, before its cleanup has
        // even run to set `cancelled` — so the second mount's renderer starts
        // initializing concurrently with the first, both racing to claim the
        // same <canvas>'s GPU context. Yielding one microtask here lets the
        // first mount's cleanup (which is synchronous) land first, so its
        // `cancelled` check below is already true and it bails before ever
        // touching the canvas — only the second (real) mount constructs a
        // renderer. This is what was producing two "WebGPU is not available"
        // logs and, on real mobile GPUs, "WebGL Device Lost" from two live
        // contexts fighting over one canvas.
        await Promise.resolve();
        if (cancelled) return;

        // no forceWebGL — WebGPURenderer probes for real WebGPU first and
        // silently falls back to a WebGL2 backend when unavailable (nearly
        // every mobile browser today). createGrassScene() then separately
        // picks Grass vs. FallbackGrass depending on what that backend
        // supports. This try/catch exists so that if init() (or scene setup)
        // fails for any OTHER reason — e.g. no WebGL2 context at all — the
        // user gets a visible message instead of a silently blank canvas,
        // which is what a device with no console access just looks like.
        // ?forceWebGL=1 lets us test the mobile/non-WebGPU code path on a
        // desktop browser that does have WebGPU, instead of needing an
        // actual old device — remove once mobile rendering is confirmed good
        const forceWebGL = new URLSearchParams(window.location.search).has("forceWebGL");
        renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
        await renderer.init();
        // dispose only AFTER init() actually settles — disposing mid-init
        // tears down a WebGL2 context that isn't finished being created, and
        // on a React Strict Mode dev double-mount the effect re-runs
        // immediately after, creating a SECOND renderer/context while this
        // one is still winding down. Two live GPU contexts on one mobile GPU
        // at once is a real, observed trigger for "WebGL Device Lost".
        if (cancelled) {
          renderer.dispose();
          return;
        }

        scene = await createGrassScene(renderer, canvas);
        if (cancelled) {
          scene.dispose();
          renderer.dispose();
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
      // renderer/scene disposal happens above, inside the async chain, once
      // init()/createGrassScene() actually settle — see comment there
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
