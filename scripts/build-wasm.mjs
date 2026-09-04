import { spawnSync } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const crateDirectory = resolve(rootDirectory, 'crates/lufs-meter')
const sourcePath = resolve(crateDirectory, 'target/wasm32-unknown-unknown/release/lufs_meter.wasm')
const destinationPath = resolve(rootDirectory, 'src/wasm/lufs_meter.wasm')

const cargo = spawnSync(
  'cargo',
  [
    'build',
    '--manifest-path',
    resolve(crateDirectory, 'Cargo.toml'),
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
  ],
  { cwd: rootDirectory, stdio: 'inherit' },
)

if (cargo.error) throw cargo.error
if (cargo.status !== 0) process.exit(cargo.status ?? 1)

await mkdir(dirname(destinationPath), { recursive: true })
await copyFile(sourcePath, destinationPath)
