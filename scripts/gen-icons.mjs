// Generate PWA icons from static/icon.svg
// Run once: node scripts/gen-icons.mjs
import sharp from 'sharp'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')
const svg = readFileSync(resolve(root, 'static/icon.svg'))

const sizes = [192, 512]
for (const size of sizes) {
  const out = resolve(root, `static/icon-${size}.png`)
  await sharp(svg).resize(size, size).png().toFile(out)
  console.log(`✓ static/icon-${size}.png`)
}
console.log('Done.')
