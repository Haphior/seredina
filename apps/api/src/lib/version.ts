import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The Seredina release this server runs: the root package.json's version,
 * found by walking up from the working directory (apps/api in development,
 * tests and the Docker image alike). Reported by /health, so an operator can
 * check an update took. "dev" when it can't be found.
 */
function readVersion(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'seredina' && pkg.version) return pkg.version;
    } catch {
      // not here; keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'dev';
}

export const SEREDINA_VERSION = readVersion();
