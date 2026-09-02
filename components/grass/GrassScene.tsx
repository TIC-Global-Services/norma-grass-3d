"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { createGrassScene, type GrassSceneHandle } from "./createGrassScene";
import { UnsupportedGrassRendererError } from "./Grass";
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
      renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
      await renderer.init();
      if (cancelled) {
        renderer.dispose();
        return;
      }

      try {
        scene = await createGrassScene(renderer, canvas);
      } catch (err) {
        if (err instanceof UnsupportedGrassRendererError) {
          setError(err.message);
          return;
        }
        throw err;
      }
      if (cancelled) {
        scene.dispose();
        return;
      }

      scene.start();
      window.addEventListener("resize", resize);
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
            <p className="max-w-md text-sm">
              This grass demo needs a browser with the WebGPU{" "}
              <code className="rounded bg-white/10 px-1">indirect-first-instance</code> feature
              (current Chrome or Edge). {error}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
