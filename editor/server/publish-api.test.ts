import { describe, expect, it } from 'vitest';
import type { Crate, CrateRecord } from '../../shared/crate';
import { ApiError, type GitResult } from './deps';
import { fakeDeps } from './fake-deps';
import { PUBLISH_PATHS, previewPublish, publish } from './publish-api';

const spotify = (albumId: string) => ({ albumId, coverUrl: '', tracks: [{ id: 't', name: 'T', durationMs: 1000 }] });
const matchInfo = (confidence: 'high' | 'medium' | 'low' | 'none', override?: boolean) => ({
  confidence, spotifyName: 'X', spotifyArtists: 'Y', spotifyYear: 1970, ...(override ? { override } : {}),
});
const rec = (rymId: string, extra: Partial<CrateRecord> = {}): CrateRecord => ({
  rymId, artist: 'A', title: `T${rymId}`, year: 1970, rating: 8, spotify: spotify(`sp${rymId}`), match: matchInfo('high'), ...extra,
});
const crate = (id: string, name: string, records: CrateRecord[]): Crate => ({ id, name, mood: 'm', createdAt: '2026-10-01', records });

/** `git status --porcelain -z` output for these `XY path` lines. */
const z = (...lines: string[]) => (lines.length ? lines.join('\0') + '\0' : '');
const ok = (stdout = ''): GitResult => ({ code: 0, stdout, stderr: '' });

function scriptedGit(opts: { status?: string[]; remote?: string; fail?: string; sha?: string; upstream?: string; unpushed?: number }) {
  return (args: string[]): GitResult => {
    if (opts.fail && args[0] === opts.fail) return { code: 1, stdout: '', stderr: `fatal: ${opts.fail} broke` };
    switch (args[0]) {
      case 'status': return ok(z(...(opts.status ?? [])));
      case 'remote': return ok(opts.remote ?? '');
      case 'rev-parse':
        if (args.includes('@{u}')) {
          return opts.upstream
            ? ok(`${opts.upstream}\n`)
            : { code: 128, stdout: '', stderr: "fatal: no upstream configured for branch 'main'\n" };
        }
        return ok(`${opts.sha ?? 'abc1234'}\n`);
      case 'rev-list': return ok(`${opts.unpushed ?? 0}\n`);
      case 'commit': return ok('[feat 1234567] message\n 1 file changed\n');
      case 'push': return ok('');
      default: return ok();
    }
  };
}

function setup(opts: Parameters<typeof scriptedGit>[0], files: Record<string, unknown> = {}) {
  return fakeDeps({
    files: {
      'library/overrides.json': {},
      'crates/index.json': { crates: ['rainy-sunday'] },
      'crates/rainy-sunday.json': crate('rainy-sunday', 'Rainy Sunday', [rec('1'), rec('2')]),
      ...files,
    },
    git: scriptedGit(opts),
  });
}

describe('previewPublish', () => {
  it('lists changes within the publish paths and has no blockers when everything is reviewed', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json', ' M library/overrides.json'], remote: 'origin\n' });
    const preview = previewPublish(deps);
    expect(preview.changes).toEqual([
      { status: 'M', path: 'crates/rainy-sunday.json' },
      { status: 'M', path: 'library/overrides.json' },
    ]);
    expect(preview.blockers).toEqual([]);
    expect(preview.hasRemote).toBe(true);
    expect(preview.suggestedMessage).toBe('Update crates: Rainy Sunday');
  });

  it('reports hasRemote false when git remote is empty', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'] });
    expect(previewPublish(deps).hasRemote).toBe(false);
  });

  it('blocks when there is nothing to publish', () => {
    const deps = setup({ status: [] });
    const preview = previewPublish(deps);
    expect(preview.changes).toEqual([]);
    expect(preview.blockers).toEqual(['Nothing to publish']);
  });

  it('blocks changed crates whose records still need review', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'] }, {
      'crates/rainy-sunday.json': crate('rainy-sunday', 'Rainy Sunday', [
        rec('1'),
        rec('2', { match: matchInfo('medium') }), // medium, no override
        rec('3', { spotify: null, match: undefined }), // never matched
        rec('4', { match: matchInfo('low', true) }), // override pinned
      ]),
    });
    expect(previewPublish(deps).blockers).toEqual(['Rainy Sunday: 2 records still need review']);
  });

  it('accepts records settled by overrides.json, including unavailable ones', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'] }, {
      'library/overrides.json': { '2': 'sp2', '3': 'unavailable' },
      'crates/rainy-sunday.json': crate('rainy-sunday', 'Rainy Sunday', [
        rec('1'),
        rec('2', { match: matchInfo('medium') }),
        rec('3', { spotify: null, match: matchInfo('none', true) }),
      ]),
    });
    expect(previewPublish(deps).blockers).toEqual([]);
  });

  it('blocks spotify: null without an unavailable override, even with a high match', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'] }, {
      'crates/rainy-sunday.json': crate('rainy-sunday', 'Rainy Sunday', [rec('1', { spotify: null })]),
    });
    expect(previewPublish(deps).blockers).toEqual(['Rainy Sunday: 1 record still needs review']);
  });

  it('only checks crates that changed', () => {
    const deps = setup({ status: [' M library/genres.json'] }, {
      'crates/rainy-sunday.json': crate('rainy-sunday', 'Rainy Sunday', [rec('1', { spotify: null, match: undefined })]),
    });
    expect(previewPublish(deps).blockers).toEqual([]);
  });

  it('blocks uncommitted changes outside the publish paths', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json', ' M builder/src/resolve.ts', '?? notes.txt'] });
    const preview = previewPublish(deps);
    expect(preview.changes).toEqual([{ status: 'M', path: 'crates/rainy-sunday.json' }]);
    expect(preview.blockers).toEqual([
      'Uncommitted changes outside crates — commit or stash them first: builder/src/resolve.ts, notes.txt',
    ]);
  });

  it('allows library/genres-mb.json to be dirty', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json', '?? library/genres-mb.json'] });
    expect(previewPublish(deps).blockers).toEqual([]);
  });

  it('parses renames and staged statuses', () => {
    const deps = setup({ status: ['R  crates/new.json', 'crates/old.json', 'A  library/genres.json'] }, {
      'crates/new.json': crate('new', 'New', [rec('1')]),
    });
    expect(previewPublish(deps).changes).toEqual([
      { status: 'R', path: 'crates/new.json' },
      { status: 'A', path: 'library/genres.json' },
    ]);
  });

  it('suggests a message naming new and changed crates', () => {
    const deps = setup({ status: [' M crates/index.json', ' M crates/rainy-sunday.json', '?? crates/samba-bossa.json'] }, {
      'crates/samba-bossa.json': crate('samba-bossa', 'Samba & Bossa', [rec('9')]),
    });
    expect(previewPublish(deps).suggestedMessage).toBe('Update crates: Samba & Bossa (new), Rainy Sunday');
  });

  it('suggests a message for deleted crates and for library-only changes', () => {
    expect(previewPublish(setup({ status: [' D crates/old-one.json'] })).suggestedMessage).toBe('Update crates: old-one (deleted)');
    expect(previewPublish(setup({ status: [' M library/genres.json', ' M library/overrides.json'] })).suggestedMessage)
      .toBe('Update genres and overrides');
  });

  it('reports no unpushed commits without a remote, and does not ask about an upstream', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'], upstream: 'origin/main', unpushed: 3 });
    expect(previewPublish(deps).unpushed).toBe(0);
    expect(deps.gitCalls.some((c) => c[0] === 'rev-list' || c.includes('@{u}'))).toBe(false);
  });

  it('reports no unpushed commits when the branch has no upstream', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'], remote: 'origin\n' });
    expect(previewPublish(deps).unpushed).toBe(0);
    expect(deps.gitCalls).toContainEqual(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    expect(deps.gitCalls.some((c) => c[0] === 'rev-list')).toBe(false);
  });

  it('counts commits ahead of the upstream', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'], remote: 'origin\n', upstream: 'origin/main', unpushed: 2 });
    expect(previewPublish(deps).unpushed).toBe(2);
    expect(deps.gitCalls).toContainEqual(['rev-list', '--count', '@{u}..HEAD']);
  });

  it('does not block on "Nothing to publish" when commits are waiting to be pushed', () => {
    const deps = setup({ status: [], remote: 'origin\n', upstream: 'origin/main', unpushed: 1 });
    const preview = previewPublish(deps);
    expect(preview.changes).toEqual([]);
    expect(preview.unpushed).toBe(1);
    expect(preview.blockers).toEqual([]);
  });

  it('still blocks unpushed commits on changes outside the publish paths', () => {
    const deps = setup({ status: [' M package.json'], remote: 'origin\n', upstream: 'origin/main', unpushed: 1 });
    expect(previewPublish(deps).blockers).toEqual(['Uncommitted changes outside crates — commit or stash them first: package.json']);
  });

  it('fails with 500 when counting unpushed commits fails', () => {
    const deps = setup({ status: [], remote: 'origin\n', upstream: 'origin/main', fail: 'rev-list' });
    expect(() => previewPublish(deps)).toThrow(expect.objectContaining({ status: 500, message: expect.stringContaining('fatal: rev-list broke') }));
  });

  it('asks git for porcelain status with every untracked file', () => {
    const deps = setup({ status: [] });
    previewPublish(deps);
    expect(deps.gitCalls[0]).toEqual(['status', '--porcelain', '-z', '--untracked-files=all']);
  });

  it('fails with 500 and git stderr when git status fails', () => {
    const deps = setup({ fail: 'status' });
    expect(() => previewPublish(deps)).toThrow(expect.objectContaining({ status: 500, message: expect.stringContaining('fatal: status broke') }));
  });
});

describe('publish', () => {
  it('commits without pushing when there is no remote', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'], sha: 'deadbeef' });
    const result = publish(deps, 'Update crates: Rainy Sunday');
    expect(result.committed).toBe('deadbeef');
    expect(result.pushed).toBe(false);
    expect(result.output).toContain('1 file changed');
    expect(deps.gitCalls.some((c) => c[0] === 'push')).toBe(false);
    const commit = deps.gitCalls.find((c) => c[0] === 'commit')!;
    expect(commit.slice(0, 3)).toEqual(['commit', '-m', 'Update crates: Rainy Sunday']);
    expect(commit.join(' ')).not.toContain('Co-Authored-By');
  });

  it('commits and pushes when a remote exists', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'], remote: 'origin\n' });
    const result = publish(deps, 'msg');
    expect(result.pushed).toBe(true);
    const order = deps.gitCalls.map((c) => c[0]).filter((c) => ['add', 'commit', 'push'].includes(c));
    expect(order).toEqual(['add', 'commit', 'push']);
  });

  it('restricts git add and git commit to the publish paths that changed', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json', ' M library/overrides.json', '?? library/genres-mb.json'] });
    publish(deps, 'msg');
    const add = deps.gitCalls.find((c) => c[0] === 'add')!;
    const paths = add.slice(add.indexOf('--') + 1);
    expect(paths).toEqual(['crates', 'library/overrides.json']);
    expect(paths.every((p) => PUBLISH_PATHS.includes(p))).toBe(true);
    const commit = deps.gitCalls.find((c) => c[0] === 'commit')!;
    expect(commit.slice(commit.indexOf('--') + 1)).toEqual(['crates', 'library/overrides.json']);
  });

  it('returns 409 with the blockers and makes no changing git calls when blocked', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json', ' M package.json'], remote: 'origin\n' });
    let err: unknown;
    try {
      publish(deps, 'msg');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toEqual({
      error: 'Publish is blocked',
      blockers: ['Uncommitted changes outside crates — commit or stash them first: package.json'],
    });
    expect(deps.gitCalls.map((c) => c[0]).filter((c) => ['add', 'commit', 'push'].includes(c))).toEqual([]);
  });

  it('rejects an empty message with 400', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'] });
    expect(() => publish(deps, '  ')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => publish(deps, undefined as unknown as string)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('returns 500 with stderr when git commit fails', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'], fail: 'commit' });
    expect(() => publish(deps, 'msg')).toThrow(expect.objectContaining({ status: 500, message: expect.stringContaining('fatal: commit broke') }));
  });

  it('pushes to the upstream with plain git push when one exists', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'], remote: 'origin\n', upstream: 'origin/main' });
    expect(publish(deps, 'msg').pushed).toBe(true);
    expect(deps.gitCalls.filter((c) => c[0] === 'push')).toEqual([['push']]);
  });

  it('sets the upstream with git push -u origin HEAD when the branch has none', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'], remote: 'origin\n' });
    expect(publish(deps, 'msg').pushed).toBe(true);
    expect(deps.gitCalls.filter((c) => c[0] === 'push')).toEqual([['push', '-u', 'origin', 'HEAD']]);
  });

  it('uses the only remote when there is no origin', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'], remote: 'github\n' });
    publish(deps, 'msg');
    expect(deps.gitCalls.filter((c) => c[0] === 'push')).toEqual([['push', '-u', 'github', 'HEAD']]);
  });

  it('retries the push without committing when there are no changes but unpushed commits', () => {
    const deps = setup({ status: [], remote: 'origin\n', upstream: 'origin/main', unpushed: 2, sha: 'beef' });
    const result = publish(deps, '');
    expect(result).toMatchObject({ committed: 'beef', pushed: true });
    const changing = deps.gitCalls.map((c) => c[0]).filter((c) => ['add', 'commit', 'push'].includes(c));
    expect(changing).toEqual(['push']);
  });

  it('reports a failed retry push with the existing commit', () => {
    const deps = setup({ status: [], remote: 'origin\n', upstream: 'origin/main', unpushed: 1, sha: 'beef', fail: 'push' });
    let err: unknown;
    try {
      publish(deps, '');
    } catch (e) {
      err = e;
    }
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).body).toMatchObject({ committed: 'beef', pushed: false, error: expect.stringContaining('fatal: push broke') });
  });

  it('returns 409 when there are no changes and nothing to push', () => {
    const deps = setup({ status: [], remote: 'origin\n', upstream: 'origin/main', unpushed: 0 });
    expect(() => publish(deps, 'msg')).toThrow(expect.objectContaining({ status: 409 }));
    expect(deps.gitCalls.some((c) => c[0] === 'push')).toBe(false);
  });

  it('reports the commit when the push fails', () => {
    const deps = setup({ status: [' M crates/rainy-sunday.json'], remote: 'origin\n', fail: 'push', sha: 'cafe' });
    let err: unknown;
    try {
      publish(deps, 'msg');
    } catch (e) {
      err = e;
    }
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).body).toMatchObject({ committed: 'cafe', pushed: false, error: expect.stringContaining('fatal: push broke') });
  });
});
