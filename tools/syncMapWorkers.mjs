import { copyFileSync } from "node:fs";

for (const filename of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(new URL(`../node_modules/maplibre-gl/dist/${filename}`, import.meta.url), new URL(`../public/${filename}`, import.meta.url));
}