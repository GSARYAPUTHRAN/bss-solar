/**
 * Generate the PWA / push icons in public/icons from the brand emblem.
 *
 *   node scripts/generate-icons.mjs
 *
 * Re-run after changing public/brand/bss-icon.png and commit the output.
 * Uses sharp, which ships with Next.js (no extra dependency).
 *
 *   icon-192.png, icon-512.png   manifest "any" icons (emblem on white)
 *   icon-maskable-512.png        manifest "maskable" icon: the emblem sits in the
 *                                central safe zone so Android's circle/squircle
 *                                crop never clips it
 *   apple-touch-icon.png         iOS Home Screen (180×180, opaque — iOS adds its
 *                                own rounded corners)
 *   badge-72.png                 Android status-bar badge: a white silhouette on
 *                                transparent (Android ignores its colours)
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "public", "brand", "bss-icon.png");
const OUT = join(ROOT, "public", "icons");
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/** The emblem scaled to `scale` of a `size` square, centred on white. */
async function onWhite(size, scale) {
  const inner = Math.round(size * scale);
  const emblem = await sharp(SOURCE)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: emblem, gravity: "centre" }])
    .flatten({ background: WHITE })
    .png({ compressionLevel: 9 });
}

/** White silhouette of the emblem's opaque pixels on a transparent square. */
async function badge(size) {
  const inner = Math.round(size * 0.9);
  const alpha = await sharp(SOURCE)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extractChannel("alpha")
    .toBuffer();
  const silhouette = await sharp({
    create: { width: inner, height: inner, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .joinChannel(alpha)
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: silhouette, gravity: "centre" }])
    .png({ compressionLevel: 9 });
}

const outputs = [
  ["icon-192.png", () => onWhite(192, 0.86)],
  ["icon-512.png", () => onWhite(512, 0.86)],
  // Maskable safe zone is a centred circle of 80% diameter; stay inside it.
  ["icon-maskable-512.png", () => onWhite(512, 0.68)],
  ["apple-touch-icon.png", () => onWhite(180, 0.82)],
  ["badge-72.png", () => badge(72)],
];

await mkdir(OUT, { recursive: true });
for (const [name, build] of outputs) {
  const image = await build();
  const info = await image.toFile(join(OUT, name));
  console.log(`public/icons/${name}  ${info.width}x${info.height}  ${info.size} bytes`);
}
