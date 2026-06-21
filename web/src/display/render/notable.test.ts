import { describe, it, expect } from "vitest";
import { classifyNotable } from "./notable";

describe("classifyNotable", () => {
  it("flags emergency squawks, with priority over everything else", () => {
    expect(classifyNotable({ squawk: "7700" })).toBe("emergency");
    expect(classifyNotable({ squawk: "7600" })).toBe("emergency");
    expect(classifyNotable({ squawk: "7500" })).toBe("emergency");
    // emergency squawk wins even if the callsign would otherwise classify
    expect(classifyNotable({ squawk: "7700", flight: "UAL123" })).toBe("emergency");
  });

  it("classifies public-service callsigns", () => {
    expect(classifyNotable({ flight: "LIFEGUARD2" })).toBe("medical");
    expect(classifyNotable({ flight: "TANKER41" })).toBe("fire");
    expect(classifyNotable({ flight: "SHERIFF1" })).toBe("police");
    expect(classifyNotable({ flight: "RCH285" })).toBe("military");
  });

  it("classifies rare + heavy by type, and returns null for ordinary traffic", () => {
    expect(classifyNotable({ typeCode: "B52" })).toBe("rare");
    expect(classifyNotable({ typeCode: "B77W" })).toBe("heavy");
    expect(classifyNotable({ category: "A5" })).toBe("heavy");
    expect(classifyNotable({ flight: "UAL123", typeCode: "A320" })).toBeNull();
    expect(classifyNotable({})).toBeNull();
  });
});
