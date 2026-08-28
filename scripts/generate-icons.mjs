// Generates PNG app icons + favicon.ico from public/icon.svg.
//
// Usage: node scripts/generate-icons.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svgPath = path.join(rootDir, "public", "icon.svg");
const publicDir = path.join(rootDir, "public");
const appDir = path.join(rootDir, "src", "app");

async function renderPng(size, outPath) {
  const svg = await readFile(svgPath);
  const buffer = await sharp(svg, { density: 384 })
    .resize(size, size)
    .png()
    .toBuffer();
  await writeFile(outPath, buffer);
  return buffer;
}

async function main() {
  await mkdir(publicDir, { recursive: true });
  await mkdir(appDir, { recursive: true });

  const png512 = await renderPng(512, path.join(publicDir, "icon-512.png"));
  const png192 = await renderPng(192, path.join(publicDir, "icon-192.png"));
  const png32 = await renderPng(32, path.join(publicDir, "icon-32.png"));

  const icoBuffer = await pngToIco([png32, png192]);
  await writeFile(path.join(appDir, "favicon.ico"), icoBuffer);

  console.log("Generated:");
  console.log(" public/icon-512.png", png512.length, "bytes");
  console.log(" public/icon-192.png", png192.length, "bytes");
  console.log(" public/icon-32.png", png32.length, "bytes");
  console.log(" src/app/favicon.ico", icoBuffer.length, "bytes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
