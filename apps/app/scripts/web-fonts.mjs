// Copies the renderer's woff2 fonts (Geist, Geist Mono, Noto Sans SC unicode-range slices) and its
// @font-face rules into public/fonts for the web export. Native bundles assets/fonts via expo-font.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const renderer = join(app, '../desktop/src/renderer');
const out = join(app, 'public/fonts');
mkdirSync(out, { recursive: true });
cpSync(join(renderer, 'assets/fonts'), out, { recursive: true });
const css = readFileSync(join(renderer, 'styles/fonts.css'), 'utf8').replaceAll('../assets/fonts/', '/fonts/');
writeFileSync(join(out, 'fonts.css'), css);
console.log('web fonts ->', out);
