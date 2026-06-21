import { describe, it, expect } from "vitest";
import { cumLen, lineLength, posAt, project, type RailLine } from "./path";

// A simple 2-vertex line running ~0.01° north (≈1.11 km) at a fixed longitude.
const line: RailLine = {
  id: "t", name: "t",
  path: [
    { lat: 47.60, lon: -122.30, tunnel: false },
    { lat: 47.61, lon: -122.30, tunnel: false },
  ],
  stationIdx: [],
};

describe("path arc-length engine", () => {
  it("cumLen + lineLength measure the polyline", () => {
    const cum = cumLen(line);
    expect(cum.length).toBe(2);
    expect(cum[0]).toBe(0);
    const total = lineLength(line);
    expect(total).toBeGreaterThan(1050);
    expect(total).toBeLessThan(1170); // ~1112 m for 0.01° latitude
  });

  it("posAt resolves endpoints and clamps out-of-range s", () => {
    const a = posAt(line, 0);
    expect(a.lat).toBeCloseTo(47.60, 5);
    expect(a.lon).toBeCloseTo(-122.30, 5);
    const z = posAt(line, 1e9); // beyond the end → clamps to the last vertex
    expect(z.lat).toBeCloseTo(47.61, 5);
  });

  it("project lands a near-line point at the right arc-length with ~zero offset", () => {
    const pr = project(line, 47.605, -122.30); // exactly mid-segment
    expect(pr.dist).toBeLessThan(5); // meters off the line
    const total = lineLength(line);
    expect(pr.s).toBeGreaterThan(total * 0.4);
    expect(pr.s).toBeLessThan(total * 0.6);
  });
});
