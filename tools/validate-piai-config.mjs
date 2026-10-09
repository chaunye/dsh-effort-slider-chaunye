// validate-piai-config.mjs
//
// Pre-flight an `llm-pi-ai` provider block against the schema of the *installed*
// DSH runtime, before writing it into a live profile. The schema lives inside the
// packaged app, so run this with the desktop binary in Node mode — Electron's fs
// shim is what lets a path inside app.asar be imported at all:
//
//   $env:ELECTRON_RUN_AS_NODE = "1"
//   & "<install>\DeepSeek Harness.exe" --expose-internals tools/validate-piai-config.mjs "<install>\resources\app.asar"
//
// (or set DSH_ASAR to that archive path).
//
// What it proves: the shape is accepted (or rejected) by the shipped schema, and
// that the checker really checks — the bogus-level case below must be rejected.
// What it does NOT prove: rules enforced later, at model resolution; e.g. "a level
// besides off must exist" is a resolution-time rule, not a schema rule.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const asar = process.env.DSH_ASAR ?? process.argv[2]
if (asar === undefined) {
  console.error('usage: node tools/validate-piai-config.mjs <path to resources/app.asar>   (or set DSH_ASAR)')
  process.exit(2)
}
const pluginUrl = pathToFileURL(join(asar, 'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')).href
const { Config } = await import(pluginUrl)

const baseModel = (extra = {}) => ({
  id: 'example-reasoner',
  name: 'example-reasoner',
  contextWindow: 1000000,
  maxTokens: 256000,
  ...extra,
})

const route = (models) => ({
  providers: {
    'example-gateway': {
      apiKeyEnv: 'EXAMPLE_GATEWAY_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://gateway.example/v1',
      models,
    },
  },
})

function report(name, config, expectation) {
  let accepted = true
  let message = ''
  try {
    new Config(config)
  } catch (error) {
    accepted = false
    message = error instanceof Error ? error.message : String(error)
  }
  const verdict = accepted === expectation ? 'as expected' : 'UNEXPECTED'
  console.log(`[${name}] ${accepted ? 'ACCEPTED' : 'REJECTED'} (${verdict}${message ? ': ' + message.slice(0, 220) : ''})`)
  return accepted === expectation
}

console.log('--- case 1: hand-declared model without reasoningEfforts (offers no levels) ---')
const noLevels = report('no-levels', route([baseModel()]), true)

console.log('--- case 2: the documented four-level shape ---')
const proposed = report('four-levels', route([
  baseModel({
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
  }),
]), true)

console.log('--- case 3: off-only levels (schema accepts; the resolution-time rule is separate) ---')
const offOnly = report('off-only', route([
  baseModel({ reasoningEfforts: { off: null } }),
]), true)

console.log('--- case 4: control, unknown level key (the schema must reject) ---')
const bogus = report('bogus-level', route([
  baseModel({ reasoningEfforts: { off: null, turbo: 'turbo' } }),
]), false)

console.log('--- case 5: thinkingFormat without supportsReasoningEffort ---')
const noSupportFlag = report('no-support-flag', route([
  baseModel({
    compat: { thinkingFormat: 'deepseek' },
    reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
  }),
]), true)

console.log('')
console.log(`documented shape accepted (as expected): ${proposed}`)
console.log(`unknown level key rejected (as expected): ${bogus}`)
console.log(`no-levels / off-only / no-support-flag accepted: ${noLevels} / ${offOnly} / ${noSupportFlag}`)
if (!noLevels || !proposed || !offOnly || !bogus || !noSupportFlag) {
  console.log('PRE-FLIGHT FAILED')
  process.exit(1)
}
console.log('PRE-FLIGHT OK')
