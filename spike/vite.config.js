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

export default defineConfig({
  server: { port: 5183, strictPort: true, fs: { allow: [root] } },
  plugins: [serveScenes],
});
