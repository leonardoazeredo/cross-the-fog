import { createServer, type Server } from "node:http";
import { answerTo } from "./streets.js";
import { terrariumTile } from "./terrarium.js";

// The stand-in for the street and elevation hosts that the e2e flows run against, so they are repeatable and can
// gate a change. It answers whatever is asked with made-up data and keeps nothing of what it is asked.

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function createStandIn(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stand-in");
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS).end();
      return;
    }
    // Overpass: the page posts `data=<query>`, to the path of whichever host it asked.
    if (req.method === "POST" && url.pathname.startsWith("/overpass")) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const query = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("data") ?? "";
        const body = JSON.stringify(answerTo(query));
        res.writeHead(200, { ...CORS, "content-type": "application/json" }).end(body);
      });
      return;
    }
    const tile = /^\/elevation\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
    if (req.method === "GET" && tile) {
      res
        .writeHead(200, { ...CORS, "content-type": "image/png" })
        .end(terrariumTile(Number(tile[2]), Number(tile[3])));
      return;
    }
    res.writeHead(404, CORS).end();
  });
}
