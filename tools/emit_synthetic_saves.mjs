// Writes synthetic DQ8 saves (made by the app's own buildSave test helper) into a directory.
// Usage: node tools/emit_synthetic_saves.mjs <outDir>
// Files: BASLUS-21207dq8_0 (gold 111) and BASLUS-21207dq8_3 (gold 333), 23,776 bytes each.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'

const outDir = process.argv[2]
if (!outDir) {
  console.error('usage: node tools/emit_synthetic_saves.mjs <outDir>')
  process.exit(2)
}

const server = await createServer({
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
})
try {
  const { buildSave } = await server.ssrLoadModule('/src/save/testing.ts')
  mkdirSync(outDir, { recursive: true })
  for (const [slot, gold] of [[0, 111], [3, 333]]) {
    writeFileSync(join(outDir, `BASLUS-21207dq8_${slot}`), buildSave({ gold }))
  }
} finally {
  await server.close()
}
