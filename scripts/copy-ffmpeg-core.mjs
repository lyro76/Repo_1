// Copie le cœur ffmpeg.wasm (JS + WASM) dans public/ffmpeg afin de le servir
// depuis la même origine (nécessaire avec COEP: require-corp).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const dest = join(root, 'public', 'ffmpeg');

if (!existsSync(src)) {
  console.warn('[clipstudio] @ffmpeg/core introuvable, export MP4 indisponible.');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  copyFileSync(join(src, file), join(dest, file));
}
console.log('[clipstudio] ffmpeg core copié dans public/ffmpeg');
