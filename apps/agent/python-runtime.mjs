import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_DIR = fileURLToPath(new URL('.', import.meta.url));

// spawn receives an executable directly (no shell). Owners can explicitly point
// to another installed environment; normal setup uses the platform's venv path.
export function resolveResearchPython({ agentDir = AGENT_DIR, platform = process.platform, environment = process.env } = {}) {
  const configured = environment.GHOST_LINKS_PYTHON?.trim();
  if (configured) return resolve(agentDir, configured);
  return resolve(agentDir, '.venv', platform === 'win32' ? 'Scripts' : 'bin', platform === 'win32' ? 'python.exe' : 'python');
}

export function researchPythonAvailable(options) {
  return existsSync(resolveResearchPython(options));
}
