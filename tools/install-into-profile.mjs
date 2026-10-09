// install-into-profile.mjs
//
// Copy the plugin into a DSH profile and mount it, with backups and a verified
// rollback. Deliberately does NOT run pnpm: the profile's node_modules holds a
// working dependency tree that a hand install has no business rewriting.
//
//   node tools/install-into-profile.mjs [--profile <dir>] [--no-config]
//
// Steps: back up package.json and cordis.patch.yml -> copy the bundle into
// node_modules -> append the bundle name to dsh.profile.bundles -> add the
// reasoningEfforts block for the diandian model -> re-parse the patch with the
// profile's own `yaml` and assert the result, restoring both files on failure.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const FILES = ['package.json', 'cordis.patch.yml', 'index.js', 'client.js', 'README.md']
const MODEL_ID = 'DeepSeek-V4.1-Flash'

const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The package name is read from the manifest so a rename cannot drift between
// the package, the bundle row and this installer.
const PACKAGE_NAME = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8')).name
const argv = process.argv.slice(2)
const profileFlag = argv.indexOf('--profile')
const applyConfig = !argv.includes('--no-config')
const profile = profileFlag >= 0
  ? resolve(argv[profileFlag + 1])
  : join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'profiles', 'desktop')

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
const log = (message) => console.log(message)

if (!existsSync(join(profile, 'package.json'))) {
  console.error(`not a DSH profile (no package.json): ${profile}`)
  process.exit(2)
}
log(`profile: ${profile}`)
log(`source : ${sourceDir}`)

// --- 1. backups -------------------------------------------------------------
const manifestPath = join(profile, 'package.json')
const patchPath = join(profile, 'cordis.patch.yml')
const manifestBackup = `${manifestPath}.bak-${PACKAGE_NAME}-${stamp}`
const patchBackup = `${patchPath}.bak-${PACKAGE_NAME}-${stamp}`
copyFileSync(manifestPath, manifestBackup)
if (existsSync(patchPath)) copyFileSync(patchPath, patchBackup)
log(`backup : ${manifestBackup}`)
if (existsSync(patchPath)) log(`backup : ${patchBackup}`)

function restore(reason) {
  copyFileSync(manifestBackup, manifestPath)
  if (existsSync(patchBackup)) copyFileSync(patchBackup, patchPath)
  console.error(`rolled back: ${reason}`)
  process.exit(1)
}

// --- 2. copy the bundle -----------------------------------------------------
const targetDir = join(profile, 'node_modules', PACKAGE_NAME)
if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
mkdirSync(targetDir, { recursive: true })
for (const file of FILES) {
  const from = join(sourceDir, file)
  if (!existsSync(from)) restore(`missing source file ${file}`)
  copyFileSync(from, join(targetDir, file))
}
log(`copied : ${FILES.length} files -> node_modules/${PACKAGE_NAME}`)

// --- 3. mount the bundle ----------------------------------------------------
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []
const before = [...manifest.dsh.profile.bundles]
if (manifest.dsh.profile.bundles.includes(PACKAGE_NAME)) {
  log(`bundles: already mounted (${before.length} entries)`)
} else {
  manifest.dsh.profile.bundles.push(PACKAGE_NAME)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  log(`bundles: ${before.join(', ')}`)
  log(`      -> ${manifest.dsh.profile.bundles.join(', ')}`)
}

// --- 4. declare the reasoning levels ---------------------------------------
if (!applyConfig) {
  log('config : skipped (--no-config); the slider will render nothing until the model declares levels')
} else if (!existsSync(patchPath)) {
  // A profile that has never booted has no patch layer yet; the bundle still
  // works, it just has no model levels to read until the operator adds them.
  log('config : no cordis.patch.yml in this profile yet, skipped')
} else {
  const original = readFileSync(patchPath, 'utf8')
  let patch = original
  if (patch.includes('reasoningEfforts')) {
    log('config : a reasoningEfforts block already exists, left untouched')
  } else {
    const lines = patch.split('\n')
    const idIndex = lines.findIndex((line) => new RegExp(`^\\s*- id:\\s*${MODEL_ID.replace(/\./g, '\\.')}\\s*$`).test(line))
    if (idIndex < 0) restore(`could not find the "${MODEL_ID}" model row in cordis.patch.yml`)
    const indent = /^(\s*)/.exec(lines[idIndex])[1] + '  '
    let insertAt = -1
    for (let i = idIndex; i < Math.min(idIndex + 12, lines.length); i += 1) {
      if (/^\s*maxTokens:\s*\d+\s*$/.test(lines[i])) { insertAt = i; break }
    }
    if (insertAt < 0) restore(`could not find maxTokens for "${MODEL_ID}"`)
    const block = [
      `${indent}compat:`,
      `${indent}  thinkingFormat: deepseek`,
      `${indent}  supportsReasoningEffort: true`,
      `${indent}reasoningEfforts:`,
      `${indent}  off:`,
      `${indent}  low: low`,
      `${indent}  high: high`,
      `${indent}  max: max`,
    ]
    lines.splice(insertAt + 1, 0, ...block)
    patch = lines.join('\n')
    writeFileSync(patchPath, patch)
    log(`config : inserted ${block.length} lines after the ${MODEL_ID} maxTokens`)
  }

  // --- 5. verify by re-parsing with the profile's own yaml ----------------
  let YAML
  try {
    YAML = await import(pathToFileURL(join(profile, 'node_modules', 'yaml', 'dist', 'index.js')).href)
  } catch (error) {
    restore(`could not load the profile's yaml parser: ${error instanceof Error ? error.message : String(error)}`)
  }
  let document
  try {
    document = YAML.parse(readFileSync(patchPath, 'utf8'))
  } catch (error) {
    restore(`cordis.patch.yml no longer parses: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(document)) restore('cordis.patch.yml is not a top-level array')
  const row = document.find((entry) => entry && entry.id === 'llm-pi-ai')
  if (row === undefined) restore('the llm-pi-ai row disappeared')
  const models = row.config?.providers?.diandian?.models ?? []
  const model = models.find((entry) => entry?.id === MODEL_ID)
  if (model === undefined) restore(`the ${MODEL_ID} model disappeared from the llm-pi-ai row`)
  const efforts = model.reasoningEfforts
  const declared = efforts === undefined ? [] : Object.keys(efforts)
  const expected = ['off', 'low', 'high', 'max']
  if (JSON.stringify(declared) !== JSON.stringify(expected)) {
    restore(`expected levels ${expected.join('/')}, parsed ${declared.join('/') || '(none)'}`)
  }
  log(`verify : parsed levels for ${MODEL_ID} = ${declared.join(', ')}`)
  log(`verify : compat = ${JSON.stringify(model.compat ?? null)}`)
}

log('')
log('installed. Restart the desktop app, then reopen this conversation to verify.')
