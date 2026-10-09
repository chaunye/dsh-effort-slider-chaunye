// uninstall-from-profile.mjs
//
// Restore the newest install backup and remove the copied plugin directory.
//
//   node tools/uninstall-from-profile.mjs [--profile <dir>] [--name <installed package name>]
import { existsSync, readdirSync, rmSync, copyFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const nameFlag = argv.indexOf('--name')
// Defaults to this package's own name; pass --name to remove an install made
// under an earlier name (the bundle row and node_modules directory both use it).
const PACKAGE_NAME = nameFlag >= 0
  ? argv[nameFlag + 1]
  : JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8')).name
const profileFlag = argv.indexOf('--profile')
const profile = profileFlag >= 0
  ? resolve(argv[profileFlag + 1])
  : join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'profiles', 'desktop')

const manifestPath = join(profile, 'package.json')
const patchPath = join(profile, 'cordis.patch.yml')
const targetDir = join(profile, 'node_modules', PACKAGE_NAME)

function newestBackup(fileName) {
  const backups = readdirSync(profile)
    .filter((name) => name.startsWith(`${fileName}.bak-${PACKAGE_NAME}-`))
    .sort()
  return backups.length === 0 ? undefined : join(profile, backups[backups.length - 1])
}

let restored = 0
for (const [path, fileName] of [[manifestPath, 'package.json'], [patchPath, 'cordis.patch.yml']]) {
  const backup = newestBackup(fileName)
  if (backup === undefined) {
    console.log(`no backup for ${fileName}, left as is`)
    continue
  }
  copyFileSync(backup, path)
  console.log(`restored ${fileName} from ${backup}`)
  restored += 1
}

if (existsSync(targetDir)) {
  rmSync(targetDir, { recursive: true, force: true })
  console.log(`removed node_modules/${PACKAGE_NAME}`)
} else {
  console.log(`node_modules/${PACKAGE_NAME} was already absent`)
}

console.log(restored > 0 ? 'uninstalled. Restart the desktop app.' : 'nothing restored; check the profile path.')
