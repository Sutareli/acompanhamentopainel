// Executa os testes: empacota tests/*.test.ts com o esbuild (que já vem com o Vite) e roda com o executor nativo do Node (node:test).
// Uso: npm test      (precisa de Node 20+ e de `npm install` feito)
import { build } from 'esbuild'
import { readdirSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out = path.join(raiz, 'node_modules', '.cache', 'testes')
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
const entradas = readdirSync(path.join(raiz, 'tests')).filter((f) => f.endsWith('.test.ts')).map((f) => path.join(raiz, 'tests', f))
await build({ entryPoints: entradas, outdir: out, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, logLevel: 'warning' })
const arquivos = readdirSync(out).filter((f) => f.endsWith('.mjs')).map((f) => path.join(out, f))
const r = spawnSync(process.execPath, ['--test', ...arquivos], { stdio: 'inherit' })
process.exit(r.status ?? 1)
