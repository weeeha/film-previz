import { defineConfig, type Plugin } from "vitest/config";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenesDir = path.join(here, "scenes");

// Dev only: serve the repo-root scenes/ folder at /scenes/ for by-hand checks with ?src= and ?collider=.
const serveScenes: Plugin = {
  name: "serve-scenes",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/scenes", (req, res, next) => {
      const rel = decodeURIComponent((req.url || "/").split("?")[0] ?? "/");
      const file = path.join(scenesDir, rel);
      if (!file.startsWith(scenesDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
      res.setHeader("Content-Type", "application/octet-stream");
      fs.createReadStream(file).pipe(res);
    });
  },
};

export default defineConfig({
  server: { port: 5185, strictPort: true },
  preview: { port: 5185, strictPort: true },
  plugins: [serveScenes],
  test: { include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"] },
});
