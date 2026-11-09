// Pure risk-tier logic shared by the CLI. Tiers: green < yellow < red.
export const TIER_ORDER = ['green', 'yellow', 'red']

export function compileRules(config) {
  const compile = (list) => list.map((p) => new RegExp(p, 'i'))
  return { red: compile(config.red), green: compile(config.green) }
}

export function classifyFile(file, rules) {
  const path = file.split('\\').join('/')
  if (rules.red.some((re) => re.test(path))) return 'red'
  if (rules.green.some((re) => re.test(path))) return 'green'
  return 'yellow'
}

export function classifyChange(files, config) {
  const rules = compileRules(config)
  const perFile = files.map((f) => ({ file: f, tier: classifyFile(f, rules) }))
  let tier = 'green'
  for (const { tier: t } of perFile) {
    if (TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(tier)) tier = t
  }
  // A repo can set a floor (for example "yellow" when it has no automated tests).
  if (config.minTier && TIER_ORDER.indexOf(config.minTier) > TIER_ORDER.indexOf(tier)) tier = config.minTier
  return { tier, perFile }
}
