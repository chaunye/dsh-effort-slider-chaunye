// Validate the plugin package against the rules the rc.2 runtime actually
// enforces, before it is copied into a live profile.
//
// Mirrors, in order, what the Host does at boot:
//   1. package.json loads and `dsh.bundle.patch` points at an existing file;
//   2. `dsh.client` parses (platform: string, inject/external: string[],
//      immediately: boolean) - packages/client/modules/src/client/manifest.ts
//   3. `exports["./client"]` resolves to an existing browser bundle;
//   4. the bundle calls window.__ModuleLoader__.load exactly once, with an id
//      equal to the package name (the module-table key);
//   5. the bundle only requires modules that exist in the platform seed table;
//   6. the bundle exports a cordis plugin object {inject, apply}.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const notes = []

const pkgPath = join(dir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
notes.push(`package: ${pkg.name}@${pkg.version}`)

// 1. bundle patch
const patchRel = pkg.dsh?.bundle?.patch
if (typeof patchRel !== 'string') problems.push('dsh.bundle.patch is missing')
else if (!existsSync(join(dir, patchRel))) problems.push(`dsh.bundle.patch target does not exist: ${patchRel}`)
else {
  const patch = readFileSync(join(dir, patchRel), 'utf8')
  if (!patch.includes(`name: '${pkg.name}'`) && !patch.includes(`name: "${pkg.name}"`)) {
    problems.push(`the patch does not insert a row named '${pkg.name}' (a subpath name would be cached as "not a client package")`)
  } else notes.push('bundle patch inserts the row under the bare package name')
}

// 2. dsh.client shape
const client = pkg.dsh?.client
if (client === undefined || typeof client !== 'object') problems.push('dsh.client is missing')
else {
  if (typeof client.platform !== 'string') problems.push('dsh.client.platform must be a string')
  if (client.inject !== undefined && (!Array.isArray(client.inject) || client.inject.some(x => typeof x !== 'string'))) {
    problems.push('dsh.client.inject must be string[]')
  }
  if (client.immediately !== undefined && typeof client.immediately !== 'boolean') {
    problems.push('dsh.client.immediately must be boolean')
  }
  if (client.platform === 'web') notes.push(`client platform=web, immediately=${client.immediately === true}, inject=[${(client.inject ?? []).join(', ')}]`)
}

// 3. client export
const clientExport = pkg.exports?.['./client']
const clientRel = typeof clientExport === 'string' ? clientExport : clientExport?.default
if (typeof clientRel !== 'string') problems.push('exports["./client"] is missing')
const clientPath = clientRel === undefined ? undefined : join(dir, clientRel)
if (clientPath !== undefined && !existsSync(clientPath)) problems.push(`exports["./client"] target does not exist: ${clientRel}`)

// 4-6. bundle contents
if (clientPath !== undefined && existsSync(clientPath)) {
  const raw = readFileSync(clientPath, 'utf8')
  // Strip comments first: the header comment mentions the loader by name.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const loads = [...code.matchAll(/__ModuleLoader__\.load\(\s*\{/g)].length
  if (loads !== 1) problems.push(`expected exactly one __ModuleLoader__.load call, found ${loads}`)
  const idMatch = /id:\s*'([^']+)'/.exec(code)
  if (idMatch === null) problems.push('the loader call has no string id')
  else if (idMatch[1] !== pkg.name) problems.push(`registered id '${idMatch[1]}' must equal the package name '${pkg.name}'`)
  else notes.push(`loader id matches the package name`)

  const seeds = new Set([
    'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
  ])
  const requires = [...code.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map(m => m[1])
  for (const spec of new Set(requires)) {
    if (!seeds.has(spec)) problems.push(`require('${spec}') is not a platform seed module (and the bundle must not require Harness Client packages)`)
  }
  notes.push(`requires: ${[...new Set(requires)].join(', ') || '(none)'}`)
  if (!/inject:\s*\[/.test(code)) problems.push('the bundle does not export an inject list')
  if (!/function apply\s*\(/.test(code)) problems.push('the bundle does not export an apply function')
  if (!/\bslots\.inject\(/.test(code)) problems.push('the bundle never calls slots.inject()')

  // Custom properties do not cross a portal: the card is portalled to
  // document.body, so any plugin-local custom property it uses must be declared
  // on the card rule itself, not only on the trigger wrapper. This is how the
  // "Ultra title was not purple" bug is kept from coming back.
  // The CSS is built from several array fragments, so reassemble it first.
  const cssRegion = /const CSS = \[([\s\S]*?)\]\.join\(''\)/.exec(code)
  const css = cssRegion === null
    ? ''
    : [...cssRegion[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'")).join('')
  if (css === '') problems.push('could not reassemble the CSS array')
  // Where they are USED is the bundle's JS (the COOL/HOT constants), so scan the
  // whole file for usages and check the reconstructed CSS for the declaration.
  const usedLocal = [...new Set([...code.matchAll(/var\((--dsh-effort-[a-z-]+)\)/g)].map(m => m[1]))]
  const cardRule = /\.dsh-effort-card\{([^}]*)\}/.exec(css)
  for (const prop of usedLocal) {
    if (cardRule === null || !cardRule[1].includes(prop + ':')) {
      problems.push(`${prop} is used inside the portalled card but is not declared on the .dsh-effort-card rule (custom properties do not cross a portal)`)
    }
  }
  notes.push(usedLocal.length === 0
    ? 'local palette: none'
    : `local palette: ${usedLocal.join(', ')} (on the card rule: ${usedLocal.every(p => cardRule !== null && cardRule[1].includes(p + ':'))})`)
}

console.log('--- notes ---')
for (const note of notes) console.log(`  ${note}`)
console.log('--- problems ---')
if (problems.length === 0) console.log('  (none)')
else for (const problem of problems) console.log(`  FAIL ${problem}`)
process.exit(problems.length === 0 ? 0 : 1)
