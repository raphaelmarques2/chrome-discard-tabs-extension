import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export default function globalSetup(): void {
  execSync('npm run build', {
    cwd: projectRoot,
    stdio: 'inherit',
  })
}
