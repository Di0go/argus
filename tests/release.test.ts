// What a release and the leak check do with git: the release never pushes (the tags `live` and `live-previous` it
// moves stay on this machine), and check-leaks --history says which ref reaches each finding, so an old commit kept
// alive by a local tag is told apart from one on a branch that would be pushed.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

test('The release never pushes, tags or anything else: it only moves local tags', () => {
  const sources = [path.join(ROOT, 'scripts/release.ts'), path.join(ROOT, 'node_modules/@organon/core/src/server/release.ts')];
  for (const f of sources) {
    const code = readFileSync(f, 'utf8');
    assert.doesNotMatch(code, /['"`]push['"`]|git push|--tags|--mirror|--follow-tags/, `${path.relative(ROOT, f)} pushes`);
  }
});

test('check-leaks --history says which ref reaches each finding: a local tag on an old commit, not the branch', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'argus-leaks-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'someone@users.noreply.github.com');
  git('config', 'user.name', 'Someone');
  // An old commit with a private address outside the fixtures, kept alive only by the release's rollback tag.
  writeFileSync(path.join(repo, 'notes.txt'), 'the server was at 10.20.30.40\n');
  git('add', '.');
  git('commit', '-q', '-m', 'old');
  git('tag', 'live-previous');
  // The branch, rewritten: it never had it.
  git('checkout', '-q', '--orphan', 'clean');
  writeFileSync(path.join(repo, 'notes.txt'), 'the server was at 192.0.2.10\n');
  git('add', '.');
  git('commit', '-q', '-m', 'rewritten');
  git('branch', '-q', '-D', 'main');
  git('branch', '-q', '-m', 'main');
  const r = spawnSync('node', [path.join(ROOT, 'scripts/check-leaks.ts'), '--history', '--repo', repo], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const line = r.stdout.split('\n').find((l) => l.includes('10.20.30.40'));
  assert.ok(line, r.stdout);
  assert.match(line, /reached from: tag live-previous/);
  assert.doesNotMatch(line, /\bmain\b/);
});
