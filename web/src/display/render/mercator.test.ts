import { describe, it, expect } from "vitest";
import { llToWorld, worldToLL, Camera } from "./mercator";

describe("mercator", () => {
  it("llToWorld / worldToLL are inverses", () => {
    for (const [lat, lon] of [[47.6, -122.3], [0, 0], [-33.9, 151.2], [60, 11]]) {
      const w = llToWorld(lat, lon);
      const back = worldToLL(w.x, w.y);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });

  it("Camera.project / unproject are inverses, and the center projects to screen-center", () => {
    const cam = new Camera({
      centerLat: 47.6, centerLon: -122.3, zoom: 9, rotationDeg: 0,
      mirrorX: false, mirrorY: false, screenW: 1280, screenH: 800,
    });
    const c = cam.project(47.6, -122.3);
    expect(c.x).toBeCloseTo(640, 6);
    expect(c.y).toBeCloseTo(400, 6);

    const p = cam.project(47.61, -122.31);
    const ll = cam.unproject(p.x, p.y);
    expect(ll.lat).toBeCloseTo(47.61, 6);
    expect(ll.lon).toBeCloseTo(-122.31, 6);
  });
});
