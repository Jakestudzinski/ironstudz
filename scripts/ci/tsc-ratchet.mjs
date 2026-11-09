#!/usr/bin/env node
// Type-error ratchet.
//
// master carries a known pile of TypeScript errors (next.config.js sets
// ignoreBuildErrors). Rather than demand a clean `tsc`, this fails CI only when a
// change ADDS errors. Errors are keyed by file + TS code + message (no line
// numbers, so unrelated edits that shift lines don't register as new).
//
//   node scripts/ci/tsc-ratchet.mjs            compare against the baseline
//   node scripts/ci/tsc-ratchet.mjs --update   rewrite the baseline (do this in a
//                                              PR that FIXES errors, never to hide new ones)
//   node scripts/ci/tsc-ratchet.mjs --input f  read tsc output from a file
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const BASELINE = new URL('../../.github/ci/tsc-baseline.json', import.meta.url)
const args = process.argv.slice(2)
const update = args.includes('--update')
const inputIdx = args.indexOf('--input')

function runTsc() {
  const require = createRequire(import.meta.url)
  const tscBin = require.resolve('typescript/bin/tsc')
  const res = spawnSync(process.execPath, [tscBin, '--noEmit', '-p', '.', '--pretty', 'false'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  return `${res.stdout || ''}\n${res.stderr || ''}`
}

const output = inputIdx >= 0 ? readFileSync(args[inputIdx + 1], 'utf8') : runTsc()

const cwd = process.cwd()
const rootVariants = [cwd, cwd.split('\\').join('/')]
const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

function normalize(text) {
  for (const root of rootVariants) text = text.split(root).join('<root>')
  return text.split('\\').join('/')
}

const counts = {}
for (const raw of output.split(/\r?\n/)) {
  const m = LINE.exec(raw.trim())
  if (!m) continue
  const key = normalize(`${m[1]}|${m[4]}|${m[5]}`)
  counts[key] = (counts[key] || 0) + 1
}
const total = Object.values(counts).reduce((a, b) => a + b, 0)

if (update) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`Baseline written: ${total} errors, ${Object.keys(sorted).length} distinct.`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.error('No baseline at .github/ci/tsc-baseline.json. Run with --update once.')
  process.exit(2)
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
const added = []
let fixed = 0
for (const [key, n] of Object.entries(counts)) {
  const before = baseline[key] || 0
  if (n > before) added.push(`${key.split('|').join('  ')}  (+${n - before})`)
}
for (const [key, n] of Object.entries(baseline)) {
  const now = counts[key] || 0
  if (now < n) fixed += n - now
}

console.log(`tsc: ${total} errors (baseline ${Object.values(baseline).reduce((a, b) => a + b, 0)}), ${fixed} fixed, ${added.length} new.`)
if (added.length) {
  console.error('\nNew TypeScript errors introduced by this change:')
  for (const line of added) console.error(`  ${line}`)
  console.error('\nFix them, or if you removed errors elsewhere, do not paper over new ones by updating the baseline.')
  process.exit(1)
}
if (fixed > 0) console.log('Errors were fixed: consider running `node scripts/ci/tsc-ratchet.mjs --update` to lock in the improvement.')
