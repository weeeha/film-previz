import { defineConfig } from "vite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const scenesDir = path.join(root, "scenes");

// Serve the repo-root scenes/ folder at /scenes/ in dev only.
const serveScenes = {
  name: "serve-scenes",
  configureServer(server) {
    server.middlewares.use("/scenes", (req, res, next) => {
      const rel = decodeURIComponent((req.url || "/").split("?")[0]);
      const file = path.join(scenesDir, rel);
      if (!file.startsWith(scenesDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
      res.setHeader("Content-Type", "application/octet-stream");
      fs.createReadStream(file).pipe(res);
    });
  },
};

// Dev only: POST /__results appends the JSON body as one line to out/phase-0-timings.jsonl.
const outDir = path.join(root, "out");
const collectResults = {
  name: "collect-results",
  configureServer(server) {
    server.middlewares.use("/__results", (req, res) => {
      if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on("end", () => {
        try {
          const obj = JSON.parse(body);
          fs.mkdirSync(outDir, { recursive: true });
          fs.appendFileSync(path.join(outDir, "phase-0-timings.jsonl"), JSON.stringify(obj) + "\n");
          res.statusCode = 204; res.end();
        } catch (e) { res.statusCode = 400; res.end("bad json"); }
      });
    });
  },
};

export default defineConfig({
  server: { port: 5183, strictPort: true, fs: { allow: [root] } },
  plugins: [serveScenes, collectResults],
});
