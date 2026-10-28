import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateCaseFeed } from '../packages/contracts/cases.mjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/cases.demo.json', import.meta.url), 'utf8'));

test('fictional feed is valid and distinguishes confirmed corrections from retained leads', () => {
  assert.equal(validateCaseFeed(fixture), fixture);
  assert.ok(fixture.cases.some(c => c.internal.source === 'retained_ledger' && c.reviewState === 'review_required'));
});
test('raw private fields cannot pass through the case projection', () => {
  for (const [target, key] of [['root', 'rawLogs'], ['case', 'editorEmail'], ['organization', 'privateNotes'], ['internal', 'reporterAccount']]) {
    const next = structuredClone(fixture);
    const object = target === 'root' ? next : target === 'case' ? next.cases[0] : next.cases[0][target];
    object[key] = 'must not be exposed';
    assert.throws(() => validateCaseFeed(next), /not allowed/);
  }
});
test('fixtures cannot silently become real-person or real-domain claims', () => {
  const next = structuredClone(fixture); next.cases[0].identifier.value = 'https://example.com';
  assert.throws(() => validateCaseFeed(next), /reserved .example/);
});
test('search leads cannot be promoted to verified stale references without evidence', () => {
  const next = structuredClone(fixture);
  next.cases[0].externalReferences = [{ url: 'https://directory.example/pantry', observedAt: next.generatedAt, state: 'still_present', quote: '', reportState: 'not_started' }];
  assert.throws(() => validateCaseFeed(next), /source evidence/);
});
test('a submitted report is not a verified external correction', () => {
  const next = structuredClone(fixture);
  next.cases[0].externalReferences = [{ url: 'https://directory.example/pantry', observedAt: next.generatedAt, state: 'still_present', quote: 'Visit the former website for pantry hours.', reportState: 'submitted' }];
  validateCaseFeed(next);
  next.cases[0].externalReferences[0].reportState = 'verified_corrected';
  assert.throws(() => validateCaseFeed(next), /checked absence/);
});
