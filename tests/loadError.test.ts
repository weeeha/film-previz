import { describe, it, expect } from "vitest";
import { classifyLoadError, fileKind, formatOf, megabytes, sizeText } from "../src/ui/loadError";

describe("scene file kinds", () => {
  it("accepts spz and ply as splat files, in any case", () => {
    for (const n of ["a.spz", "a.PLY", "set 01.Spz", "x.y.ply"]) expect(fileKind(n)).toBe("splat");
  });
  it("treats glb as a collider and everything else as unsupported", () => {
    expect(fileKind("set-01-collider.glb")).toBe("collider");
    for (const n of ["street-scan.obj", "a.splat", "a.ksplat", "a.sog", "a.gltf", "noext", "a.spz.txt", ""]) expect(fileKind(n)).toBe("unsupported");
  });
  it("names the format by extension", () => {
    expect(formatOf("a.ply")).toBe("ply");
    expect(formatOf("a.spz")).toBe("spz");
  });
});

describe("load errors", () => {
  it("calls a memory failure too large and anything else a parse failure", () => {
    expect(classifyLoadError(new RangeError("Array buffer allocation failed"))).toBe("toolarge");
    expect(classifyLoadError(new Error("WebAssembly.Memory(): could not allocate memory: out of memory"))).toBe("toolarge");
    expect(classifyLoadError(new Error("Invalid array length"))).toBe("toolarge");
    expect(classifyLoadError(new Error("Invalid SPZ file: bad magic"))).toBe("parse");
    expect(classifyLoadError("nope")).toBe("parse");
  });
});

describe("sizes", () => {
  it("writes megabytes and kilobytes", () => {
    expect(megabytes(8_376_369)).toBe("8.4 MB");
    expect(sizeText(2_856)).toBe("2.9 KB");
    expect(sizeText(111_979_531)).toBe("112.0 MB");
  });
});
