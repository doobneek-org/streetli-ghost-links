import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runPython, reportResearchFailure } from '../apps/agent/discovery-runner.mjs';
import { answerRequest, stageFailureCode } from '../apps/agent/ask.mjs';

const privateText = 'test-provider-key-and-contact@example.org';
function scriptedProcess({ stdout = '', stderr = '', code = 0, hang = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.end = () => { if (!hang) setImmediate(() => {
    child.stderr.emit('data', Buffer.from(stderr)); child.stdout.emit('data', Buffer.from(stdout)); child.emit('close', code, null);
  }); };
  child.kill = signal => { child.emit('close', null, signal); return true; };
  return () => child;
}
const run = (processOptions, options = {}) => {
  const diagnostics = [];
  return { diagnostics, result: runPython({ stage: 'plan-request', input: { request: privateText } }, {
    spawnImpl: scriptedProcess(processOptions), onDiagnostic: record => diagnostics.push(record), ...options
  }) };
};

test('Python model failures log only structured class and stage metadata', async () => {
  const { result, diagnostics } = run({ stdout: JSON.stringify({ type: 'result', error: 'ValidationError' }) + '\n', stderr: privateText });
  assert.equal((await result).error, 'ValidationError');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].stage, 'plan-request');
  assert.equal(diagnostics[0].reason, 'model_exception');
  assert.equal(diagnostics[0].exceptionClass, 'ValidationError');
  assert.ok(diagnostics[0].elapsedMs >= 0);
  assert.ok(!JSON.stringify(diagnostics).includes(privateText));
});

test('a process with no result identifies its exit and recognized traceback class without the message', async () => {
  const { result, diagnostics } = run({ code: 1, stderr: `Traceback:\n  File "/app/private/path.py"\nModuleNotFoundError: ${privateText}\n` });
  assert.equal((await result).error, 'no_result');
  assert.equal(diagnostics[0].reason, 'no_result');
  assert.equal(diagnostics[0].exitCode, 1);
  assert.equal(diagnostics[0].exceptionClass, 'ModuleNotFoundError');
  assert.ok(!JSON.stringify(diagnostics).includes(privateText));
  assert.ok(!JSON.stringify(diagnostics).includes('/app/private'));
});

test('a timeout remains a timeout even when terminating the child immediately emits close', async () => {
  const { result, diagnostics } = run({ hang: true }, { timeoutMs: 5 });
  assert.equal((await result).error, 'timeout');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].reason, 'timeout');
});

test('a final result without a newline is parsed, and synchronous spawn failures settle safely', async () => {
  const completed = run({ stdout: JSON.stringify({ type: 'result', output: { route: 'records' } }) });
  assert.deepEqual((await completed.result).output, { route: 'records' });
  assert.equal(completed.diagnostics.length, 0);
  const failed = run({}, { spawnImpl: () => { throw new Error(privateText); } });
  assert.equal((await failed.result).error, 'runtime_unavailable');
  assert.equal(failed.diagnostics[0].reason, 'runtime_unavailable');
  assert.ok(!JSON.stringify(failed.diagnostics).includes(privateText));
});

test('request planning logs a failed stage while preserving its browser-safe result', async () => {
  const diagnostics = [];
  const result = await answerRequest(privateText, { cases: [] }, {
    runStage: async () => ({ error: 'ValidationError' }), onDiagnostic: record => diagnostics.push(record)
  });
  assert.deepEqual(result, { error: 'request_not_understood' });
  assert.equal(diagnostics[0].stage, 'plan-request');
  assert.equal(diagnostics[0].exceptionClass, 'ValidationError');
  assert.ok(!JSON.stringify(diagnostics).includes(privateText));
});

test('unrecognized error classes and stage names are replaced, and logger failures cannot change results', async () => {
  const diagnostics = [];
  reportResearchFailure({ stage: privateText, reason: privateText, exceptionClass: privateText }, record => diagnostics.push(record));
  assert.equal(diagnostics[0].stage, 'unknown');
  assert.equal(diagnostics[0].exceptionClass, 'UnknownException');
  assert.ok(!JSON.stringify(diagnostics).includes(privateText));
  const result = await answerRequest(privateText, { cases: [] }, {
    runStage: async () => { throw new TypeError(privateText); }, onDiagnostic: () => { throw Error('log unavailable'); }
  });
  assert.deepEqual(result, { error: 'request_not_understood' });
});

test('known provider busy and timeout classes produce bounded retry codes without exposing arbitrary errors', async () => {
  for (const error of ['RateLimitError', 'LLMRateLimitError']) {
    assert.equal(stageFailureCode(error), 'provider_busy');
    assert.deepEqual(await answerRequest(privateText, { cases: [] }, {
      runStage: async () => ({ error }), onDiagnostic: () => {}
    }), { error: 'provider_busy' });
  }
  for (const error of ['timeout', 'TimeoutError', 'APITimeoutError', 'LLMTimeoutError']) {
    assert.equal(stageFailureCode(error), 'provider_timeout');
    assert.deepEqual(await answerRequest(privateText, { cases: [] }, {
      runStage: async () => ({ error }), onDiagnostic: () => {}
    }), { error: 'provider_timeout' });
  }
  assert.equal(stageFailureCode(`RateLimitError: ${privateText}`), 'request_not_understood');
  const thrown = Object.assign(new Error(privateText), { name: 'LLMRateLimitError' });
  assert.deepEqual(await answerRequest(privateText, { cases: [] }, {
    runStage: async () => { throw thrown; }, onDiagnostic: () => {}
  }), { error: 'provider_busy' });
});
