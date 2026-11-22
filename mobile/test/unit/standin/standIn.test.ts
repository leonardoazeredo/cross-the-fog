import type { AddressInfo } from "node:net";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rectQuery, splitAnswer } from "../../../../app/src/streetDownload.ts";
import { tileBounds, tilesCovering } from "../../../../app/src/streetGrid.ts";
import { createStandIn } from "../../../scripts/standin/server.js";
import { boxesOf, waysIn } from "../../../scripts/standin/streets.js";
import { heightAt, terrariumTile } from "../../../scripts/standin/terrarium.js";

const server = createStandIn();
let base = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const post = (path: string, query: string) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });

// Two neighbouring street tiles of the grid the page asks for, as one request asks for them.
const AREA = { s: 51.5, w: -0.12, n: 51.52, e: -0.09 };

describe("the stand-in's Overpass answers", () => {
  it("reads the boxes back out of a rectQuery", () => {
    const tiles = tilesCovering(AREA);
    const boxes = tiles.map(tileBounds);
    expect(boxesOf(rectQuery(boxes)).length).toBe(boxes.length);
    expect(boxesOf(rectQuery(boxes))[0]).toEqual({
      s: Number(boxes[0]?.s.toFixed(4)),
      w: Number(boxes[0]?.w.toFixed(4)),
      n: Number(boxes[0]?.n.toFixed(4)),
      e: Number(boxes[0]?.e.toFixed(4)),
    });
  });

  it("answers a rectQuery with an answer the page's own splitAnswer accepts, ways in every tile", async () => {
    const tiles = tilesCovering(AREA);
    const res = await post("/overpass/api/interpreter", rectQuery(tiles.map(tileBounds)));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const answers = splitAnswer(await res.json(), tiles);
    expect(answers.size).toBe(tiles.length);
    for (const answer of answers.values()) expect(answer.ways.length).toBeGreaterThan(50);
  });

  it("names a way the same in two requests that both reach it, so a tile pair holds it once", async () => {
    const [a, b] = tilesCovering(AREA);
    const [boxA, boxB] = [a, b].map((t) => tileBounds(t as never));
    const one = waysIn([boxA as never]);
    const two = waysIn([boxB as never]);
    const shared = one.filter((w) => two.some((x) => x.id === w.id));
    expect(shared.length).toBeGreaterThan(0);
    expect(new Set(one.map((w) => w.id)).size).toBe(one.length);
  });

  it("joins the streets: neighbouring segments share their node ids", () => {
    const ways = waysIn([{ s: 51.5, w: -0.12, n: 51.502, e: -0.117 }]);
    const ends = new Map<number, number>();
    for (const w of ways) for (const n of w.nodes) ends.set(n, (ends.get(n) ?? 0) + 1);
    expect([...ends.values()].some((count) => count >= 3)).toBe(true);
  });

  it("answers the same query with the same body", async () => {
    const q = rectQuery(tilesCovering(AREA).map(tileBounds));
    const [x, y] = await Promise.all([post("/overpass/a", q), post("/overpass/b", q)]);
    expect(await x.text()).toBe(await y.text());
  });

  it("answers a query that names no box with just the closing count", async () => {
    const body = (await (await post("/overpass/x", "[out:json];")).json()) as {
      elements: unknown[];
    };
    expect(body.elements).toEqual([expect.objectContaining({ type: "count" })]);
  });
});

describe("the stand-in's elevation tiles", () => {
  function decode(png: Uint8Array) {
    const idat: Buffer[] = [];
    let at = 8;
    while (at < png.length) {
      const length = new DataView(png.buffer, png.byteOffset + at).getUint32(0);
      const type = Buffer.from(png.subarray(at + 4, at + 8)).toString("latin1");
      if (type === "IDAT") idat.push(Buffer.from(png.subarray(at + 8, at + 8 + length)));
      at += 12 + length;
    }
    return inflateSync(Buffer.concat(idat));
  }

  it("serves a PNG whose pixels decode, as the page's terrarium reader does, to the made-up height", async () => {
    const res = await fetch(`${base}/elevation/terrarium/12/2046/1362.png`);
    expect(res.headers.get("content-type")).toBe("image/png");
    const raw = decode(new Uint8Array(await res.arrayBuffer()));
    expect(raw.length).toBe(256 * (1 + 256 * 3));
    for (const [px, py] of [
      [0, 0],
      [100, 37],
      [255, 255],
    ] as const) {
      const at = py * (1 + 256 * 3) + 1 + px * 3;
      const height =
        (raw[at] as number) * 256 + (raw[at + 1] as number) + (raw[at + 2] as number) / 256 - 32768;
      expect(height).toBeCloseTo(heightAt(2046 * 256 + px, 1362 * 256 + py), 2);
    }
  });

  it("is continuous across the edge between two tiles", () => {
    expect(heightAt(256 * 5 - 1, 77)).toBeCloseTo(heightAt(256 * 5, 77), 0);
    expect(terrariumTile(1, 1).length).toBeGreaterThan(1000);
  });

  it("answers anything else with 404", async () => {
    expect((await fetch(`${base}/nothing`)).status).toBe(404);
  });
});
