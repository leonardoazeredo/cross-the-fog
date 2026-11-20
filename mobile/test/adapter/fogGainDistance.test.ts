import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { distanceM } from "../../../app/src/fogGain.ts";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../../../app");

interface LeafletLike {
  latLng(lat: number, lng: number): { distanceTo(other: unknown): number };
}

// The vendored Leaflet is what measures a route on the page; the fog gain module must give its numbers to the last digit.
function leaflet(): LeafletLike {
  (window as unknown as { eval(code: string): void }).eval(
    readFileSync(`${APP}/vendor/leaflet.js`, "utf-8"),
  );
  return (window as unknown as { L: LeafletLike }).L;
}

function* randomPairs(count: number): Generator<[number, number, number, number]> {
  let seed = 12345;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const near = i % 2 === 0; // half of them a few hundred metres apart, as route steps are
    const lat = next() * 170 - 85;
    const lng = next() * 360 - 180;
    yield near
      ? [lat, lng, lat + (next() - 0.5) * 0.01, lng + (next() - 0.5) * 0.01]
      : [lat, lng, next() * 170 - 85, next() * 360 - 180];
  }
}

it("measures every pair of points exactly as Leaflet's distanceTo does", () => {
  const L = leaflet();
  let checked = 0;
  for (const [lat1, lng1, lat2, lng2] of randomPairs(4000)) {
    expect(distanceM(lat1, lng1, lat2, lng2)).toBe(
      L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2)),
    );
    checked++;
  }
  expect(checked).toBe(4000);
});

it("agrees at the edges: the same point, the poles, the antimeridian and the equator", () => {
  const L = leaflet();
  const edges: Array<[number, number, number, number]> = [
    [51, 13.7, 51, 13.7],
    [90, 0, -90, 0],
    [0, 179.999, 0, -179.999],
    [0, 0, 0, 180],
    [85.0511, 0, 85.0511, 180],
  ];
  for (const [lat1, lng1, lat2, lng2] of edges) {
    expect(distanceM(lat1, lng1, lat2, lng2)).toBe(
      L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2)),
    );
  }
});
