import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveResearchPython, researchPythonAvailable } from '../apps/agent/python-runtime.mjs';

test('research runtime chooses Windows and Unix virtual environments without requiring a shell', () => {
  const agentDir=join(tmpdir(),'ghost-agent');
  assert.equal(resolveResearchPython({agentDir,platform:'win32',environment:{}}),join(agentDir,'.venv','Scripts','python.exe'));
  assert.equal(resolveResearchPython({agentDir,platform:'linux',environment:{}}),join(agentDir,'.venv','bin','python'));
});

test('explicit research Python configuration is resolved relative to the agent and checked for availability', async () => {
  const agentDir=await mkdtemp(join(tmpdir(),'ghost-python-'));
  const options={agentDir,platform:'win32',environment:{GHOST_LINKS_PYTHON:'custom/python.exe'}};
  assert.equal(researchPythonAvailable(options),false);
  await mkdir(join(agentDir,'custom'));
  await writeFile(join(agentDir,'custom','python.exe'),'stand-in executable path');
  assert.equal(resolveResearchPython(options),join(agentDir,'custom','python.exe'));
  assert.equal(researchPythonAvailable(options),true);
});
