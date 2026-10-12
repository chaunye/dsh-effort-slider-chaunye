// verify-profile-composition.mjs
//
// Compose a live profile with the *running* DSH's own boot code and report
// whether a bundle's rows survive into the entry list, plus what the Settings
// plugin list will compute for it. This follows the same path the app takes at
// start (bundle layers, then the profile's own cordis.patch.yml user layer), so
// it answers "will it load, and will it be listed" without a restart.
//
// Run with the desktop binary in Node mode — Electron's fs shim is what lets
// code inside app.asar be imported at all:
//
//   $env:ELECTRON_RUN_AS_NODE = "1"
//   & "<install>\DeepSeek Harness.exe" --expose-internals `
//       tools/verify-profile-composition.mjs "<install>\resources\app.asar" `
//       "<home>\.dsh\profiles\desktop" [bundle name]
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [asar, profileDir, bundleName] = process.argv.slice(2)
if (asar === undefined || profileDir === undefined) {
  console.error('usage: node verify-profile-composition.mjs <app.asar> <profile dir> [bundle name]')
  process.exit(2)
}
const boot = await import(pathToFileURL(join(asar, 'dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')).href)
const anchor = join(asar, 'dsh/node_modules/@deepseek-ai/dsh/package.json')
const needle = bundleName ?? 'dsh-effort-slider-chaunye'

const profile = boot.loadProfileDirectory('dsh', profileDir, anchor)
const layers = profile.layers ?? []
const bundleDocs = layers.flatMap((layer) => layer.patches ?? [])
const userDocs = profile.patches ?? []
console.log(`profile: ${profile.name ?? '(directory)'}`)
console.log(`bundle layers: ${layers.length}  patch docs: ${bundleDocs.length}`)
console.log(`user layer (cordis.patch.yml) docs: ${userDocs.length}`)
if ((profile.skippedBundles ?? []).length > 0) {
  console.log(`skipped bundles: ${profile.skippedBundles.map((b) => b.name ?? String(b)).join(', ')}`)
}

const entries = boot.composeEntries([...bundleDocs, ...userDocs])
console.log(`composed entries: ${entries.length}`)

const rows = entries.filter((entry) => String(entry?.name ?? '').includes(needle) || String(entry?.id ?? '').includes(needle))
console.log(`--- rows matching "${needle}": ${rows.length}`)
for (const row of rows) {
  console.log(`  id=${row.id} name=${row.name} disabled=${JSON.stringify(row.disabled ?? false)}`)
}

// What the Settings plugin list computes: `installed` comes from the profile
// manifest's dependencies, `enabled` from dsh.profile.bundles. A row that is
// selected but not a declared dependency loads fine yet stays unlisted.
const manifest = boot.readProfileManifest('dsh', profileDir)
const dependencies = Object.keys(manifest.dependencies ?? {})
const selected = manifest.dsh?.profile?.bundles ?? []
const stale = [...dependencies, ...selected].filter((name) => name.includes('effort-slider') && name !== needle)
console.log('--- what the plugin list will compute ---')
console.log(`  in dependencies (=> installed): ${dependencies.includes(needle)}`)
console.log(`  in bundles      (=> enabled):   ${selected.includes(needle)}`)
console.log(`  stale effort-slider names:      ${stale.length ? stale.join(', ') : '(none)'}`)

const ok = rows.length > 0 && rows.every((row) => row.disabled !== true)
  && dependencies.includes(needle) && selected.includes(needle) && stale.length === 0
console.log(ok ? 'COMPOSITION OK' : 'COMPOSITION INCOMPLETE')
process.exit(ok ? 0 : 1)
