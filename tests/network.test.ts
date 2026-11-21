import { describe, it, expect } from "vitest";
import { networkViolations, type Req } from "./helpers/network";

const origin = "localhost:5185";
const head = new Uint8Array(Array.from({ length: 64 }, (_, i) => (i * 7 + 3) % 256));
const scene = new Uint8Array(4096).map((_, i) => (i * 13) % 251);
scene.set(head, 0);

describe("network check", () => {
  const clean: Req[] = [
    { url: "http://localhost:5185/", method: "GET", body: null },
    { url: "http://localhost:5185/src/main.ts", method: "GET", body: null },
    { url: "ws://localhost:5185/?token=x", method: "GET", body: null },
    { url: "blob:http://localhost:5185/abc", method: "GET", body: null },
    { url: "data:image/png;base64,AAAA", method: "GET", body: null },
  ];
  it("passes a log with only own-origin requests, blob and data URLs", () => {
    expect(networkViolations(clean, origin, head)).toEqual([]);
  });
  it("catches the first kilobyte of the scene posted to the same origin, which the size rule alone lets through", () => {
    const leak: Req = { url: "http://localhost:5185/leak", method: "POST", body: scene.subarray(0, 1024) };
    const v = networkViolations([...clean, leak], origin, head);
    expect(v).toEqual(["scene bytes in the body: POST http://localhost:5185/leak"]);
  });
  it("catches a request to another host", () => {
    expect(networkViolations([...clean, { url: "https://example.com/x", method: "GET", body: null }], origin, head)).toEqual(["other host: GET https://example.com/x"]);
    expect(networkViolations([{ url: "http://localhost:5186/x", method: "GET", body: null }], origin, head)).toHaveLength(1);
  });
  it("catches a body over 10 KB", () => {
    const big: Req = { url: "http://localhost:5185/up", method: "POST", body: new Uint8Array(10 * 1024 + 1) };
    expect(networkViolations([big], origin, head)).toEqual(["body over 10240 bytes (10241): POST http://localhost:5185/up"]);
  });
});
