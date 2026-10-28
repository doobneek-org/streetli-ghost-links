// Reviewer decisions on cases (resolved / not an issue / needs follow-up), kept in the
// ignored data/ folder. A decision is a reviewer's note, not a verified correction:
// it never edits Streetli and never changes a case's externalReferences.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PATH = fileURLToPath(new URL('../../data/review-actions.json', import.meta.url));
export const DECISIONS = ['resolved', 'not_an_issue', 'follow_up'];

export function createReviewStore({ path = DEFAULT_PATH, now = () => new Date() } = {}) {
  let actions = null;
  const load = async () => {
    if (actions) return actions;
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      actions = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { actions = {}; }
    return actions;
  };
  const save = async () => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(actions, null, 2));
    await rename(temporary, path);
  };
  // Keys include the feed mode so fixture decisions never mix with live ones.
  const key = (mode, caseId) => `${mode}:${caseId}`;
  return {
    async list(mode) {
      const all = await load();
      return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(`${mode}:`)).map(([k, v]) => [k.slice(mode.length + 1), v]));
    },
    async set(mode, caseId, decision, note = '', by = '') {
      const all = await load();
      if (decision === 'open') delete all[key(mode, caseId)];
      else all[key(mode, caseId)] = { decision, note, by: by || 'Anonymous', at: now().toISOString().replace(/\.\d+Z$/, 'Z') };
      await save();
      return all[key(mode, caseId)] || null;
    }
  };
}

export function parseDecision(body) {
  const caseId = typeof body?.caseId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(body.caseId) ? body.caseId : null;
  const decision = [...DECISIONS, 'open'].includes(body?.decision) ? body.decision : null;
  const note = body?.note === undefined ? '' : typeof body.note === 'string' && body.note.length <= 300 && !/[\u0000-\u001f]/.test(body.note) ? body.note.trim() : null;
  const by = body?.by === undefined || body.by === '' ? '' : typeof body.by === 'string' && body.by.length <= 40 && /^[\p{L}\p{N} ._'-]+$/u.test(body.by) ? body.by.trim() : null;
  return caseId && decision && note !== null && by !== null ? { caseId, decision, note, by } : null;
}

// Leaderboard from current reviewer decisions. Points reward triage, most of all a
// resolution; they count decisions recorded here, not verified external corrections.
export const POINTS = { resolved: 10, not_an_issue: 3, follow_up: 1 };
export function leaderboard(actions) {
  const people = new Map();
  for (const action of Object.values(actions || {})) {
    const name = action?.by || 'Anonymous';
    const entry = people.get(name) || { name, resolved: 0, notAnIssue: 0, followUp: 0, points: 0, lastAt: '' };
    if (action.decision === 'resolved') entry.resolved++;
    if (action.decision === 'not_an_issue') entry.notAnIssue++;
    if (action.decision === 'follow_up') entry.followUp++;
    entry.points += POINTS[action.decision] || 0;
    if (String(action.at) > entry.lastAt) entry.lastAt = action.at;
    people.set(name, entry);
  }
  return [...people.values()].sort((a, b) => b.points - a.points || b.resolved - a.resolved || a.name.localeCompare(b.name)).slice(0, 20);
}
