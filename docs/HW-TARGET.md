# Hardware target & build optimization

The build is shaped by the box it runs on: a **Raspberry Pi 5** driving a touch
display, 24/7. Optimize for *this* environment, not a generic server.

## The target

- **SoC:** Broadcom BCM2712 — 4× Cortex-A76 @ 2.4 GHz, ARMv8.2-A (64-bit).
- **GPU:** VideoCore VII — OpenGL ES 3.1, Vulkan 1.2 (V3DV). HEVC decode; **no HW
  H.264 encode**.
- **RAM:** 4–8 GB LPDDR4X. **Storage:** microSD (slow, wear-prone) or NVMe via PCIe.
- **Display out:** dual 4Kp60 micro-HDMI. **Net:** dual-band WiFi 5.
- **Workload:** one Chromium kiosk rendering the sky + a tiny Go server + the decoder.

## The constraints that drive the architecture

1. **The browser GPU path is the wildcard — do not assume WebGL is fast here.**
   Chromium's native-Wayland GPU path crashes on the Pi 5 (V3D MakeCurrent failures),
   so v1 forces it through **Xwayland** (`--ozone-platform=x11`). Under Xwayland,
   Chromium often falls back to **software GL (SwiftShader)**, which would make WebGL
   *slower* than tuned Canvas2D. **Therefore the renderer is Canvas2D-first not as
   timidity but as the correct default for this hardware** — and "add WebGL later" is
   conditional on a **spike that proves GPU acceleration actually works** on this exact
   Pi 5 + Chromium + compositor stack (try Vulkan/ANGLE: `--use-gl=angle
   --use-angle=vulkan`, or `--enable-features=Vulkan`; check `chrome://gpu`). Decide
   2D vs hybrid GL by *measurement on the box*, before committing the renderer.

2. **Rendering is single-thread CPU paint-bound.** The A76 is strong, but Canvas2D
   paint is one thread. Carry over v1's CPU discipline as first-class requirements:
   - Offscreen **static-map cache** (render the basemap once, blit per frame).
   - **Cap the expensive per-plane layers** (gradient trails, dest arcs) to nearest-N.
   - **Zero per-frame allocations** — cache gradients/paths/text metrics; reuse buffers.
   - **FPS cap 24–30** (slow traffic doesn't need 60); cap **devicePixelRatio**.
   - **Avoid `shadowBlur`** (very costly on CPU canvas) — pre-bake a glow sprite.
   - `getContext("2d", { alpha: false })`.
   - Optional: move track interpolation to an **OffscreenCanvas + Web Worker** so the
     paint thread isn't doing math (only if the spike shows we need it).

3. **Memory: Chromium is the hog and grows.** Keep the bounded enrichment/photo/tile
   caches, and the **nightly kiosk restart** (already in setup-kiosk). The Go binary is
   negligible (single static binary, instant start) — a real win over Node here.

4. **microSD is slow and wears out.** Logs to **RAM** (journald volatile, in
   harden-pi), **atomic + debounced** config writes, **no recordings** (cut), and
   prefer **NVMe** if the HAT is present. Minimize steady-state writes.

5. **Thermals:** 24/7 on a Pi 5 needs active cooling; low CPU load (FPS cap, efficient
   paint) also keeps it cooler and avoids throttling. (Hardware, but the software helps.)

6. **Network:** WiFi 5 — cache tiles aggressively (bounded LRU), adaptive zoom, keyless
   sources (CARTO/Esri/adsbdb/planespotters/Celestrak); tolerate offline (disk caches).

## Build optimizations applied

- **Go:** `CGO_ENABLED=0` (one static binary), `GOARCH=arm64 GOARM64=v8.2` (A76
  codegen), `-trimpath -ldflags "-s -w"` (small). Instant startup, flat low memory.
- **Web:** Vite production build, **code-split** display vs control, heavy libs
  (celestial/satellite math) lazy-loaded, bundle embedded in the binary.
- **Kiosk:** Xwayland path as the safe default (the Pi 5 workaround), memory-reducing
  Chromium flags, nightly refresh; the GPU spike is documented, not assumed.

## Decision rule

**Workstream 0 (a hardware spike on the actual Pi 5) precedes the renderer build.**
It decides Canvas2D-only vs Canvas2D+selective-WebGL by measuring `chrome://gpu`,
frame times under load, and whether Vulkan/ANGLE gives real acceleration. We do not
build the renderer on an assumption about the GPU.
