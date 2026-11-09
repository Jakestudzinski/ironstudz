#!/usr/bin/env node
// Usage: node scripts/ci/risk-tier.mjs [--base origin/master] [--json]
// Prints the risk tier of the files changed between the merge-base and HEAD.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { classifyChange } from './riskTier.mjs'

const args = process.argv.slice(2)
const baseIdx = args.indexOf('--base')
const base = baseIdx >= 0 ? args[baseIdx + 1] : 'origin/master'
const asJson = args.includes('--json')

const config = JSON.parse(readFileSync(new URL('../../.github/ci/risk-paths.json', import.meta.url), 'utf8'))
const files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)

const result = classifyChange(files, config)

if (asJson) {
  console.log(JSON.stringify(result, null, 2))
} else {
  for (const { file, tier } of result.perFile) console.error(`${tier.padEnd(6)} ${file}`)
  console.log(result.tier)
}
