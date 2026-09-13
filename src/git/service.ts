import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileService, hash } from '../host/files';
import { githubRepository } from '../host/workspaces';
import { classify, owner, within } from '../domain/scopes';
import type { Space } from '../domain/types';
import type {
  CloneRepository,
  GitChange,
  GitConflict,
  GitDiff,
  GitHistory,
  GitRemote,
  GitStatus,
  GitSyncAction,
} from '../domain/git';
import { GitError, GitProcess } from './process';

const literal = (name: string) => `:(top,literal)${name}`;
const oidPattern = /^[a-f0-9]{40,64}$/;
const conflictCodes = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const diffOptions = ['--no-ext-diff', '--no-textconv', '--no-renames', '--no-color'];
const stale = () =>
  Error(
    '確認後に Git またはファイルが変更されました。一覧・差分を更新してから再試行してください。',
  );

export class GitService {
  private process = new GitProcess();
  private queues = new Map<string, Promise<unknown>>();
  private pending = 0;
  private fetched = new Map<string, string>();
  constructor(
    private files: FileService,
    private canMutate: () => boolean = () => true,
  ) {}
  get busy() {
    return this.pending > 0;
  }
  private git(s: Space, args: string[], options?: Parameters<GitProcess['run']>[2]) {
    return this.process.run(s.root, args, options);
  }
  private async root(id: string) {
    const s = this.files.get(id);
    if ((await fs.realpath(s.root)) !== s.root)
      throw Error('スペースの配置が変更されました。登録先を確認してください。');
    const gitRoot = (await this.git(s, ['rev-parse', '--show-toplevel'])).trimEnd();
    if ((await fs.realpath(gitRoot)) !== s.root)
      throw Error('Git 操作にはリポジトリのルートを登録してください。');
    return s;
  }
  private mutate<T>(id: string, fn: (s: Space) => Promise<T>): Promise<T> {
    if (!this.canMutate())
      return Promise.reject(
        Error('保存・エージェント・接続処理の完了後に Git 操作を再試行してください。'),
      );
    const key = this.files.get(id).root;
    this.pending++;
    const next = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.canMutate()) throw Error('別の処理が実行中です。完了後に再試行してください。');
        return fn(await this.root(id));
      });
    this.queues.set(key, next);
    return next.finally(() => {
      this.pending--;
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
  }
  private validateName(p: string) {
    if (
      !p ||
      p.length > 4096 ||
      p.includes('\0') ||
      p.includes('\\') ||
      path.isAbsolute(p) ||
      path.win32.isAbsolute(p) ||
      p.split('/').some((v) => !v || v === '.' || v === '..' || v.toLowerCase() === '.git')
    )
      throw Error('この Git パスは操作できません。');
  }
  private boundary(s: Space, p: string) {
    this.validateName(p);
    const target = path.join(s.root, p);
    if (classify(s, p) === 'contents') throw Error('クラウド資料は Git の対象にできません。');
    if (owner(this.files.list(), target)?.scopeId !== s.scopeId)
      throw Error('別のスペースが所有するファイルです。');
  }
  private async safePath(s: Space, p: string) {
    this.boundary(s, p);
    const segments = p.split('/');
    let current = s.root;
    for (const segment of segments) {
      current = path.join(current, segment);
      try {
        const info = await fs.lstat(current);
        if (info.isSymbolicLink()) throw Error('リンクを経由する Git 操作には対応していません。');
        if (current === path.join(s.root, p) && info.isDirectory())
          throw Error('ディレクトリ・submodule は所有するリポジトリ側で操作してください。');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  private exclusions(s: Space) {
    return [
      ...s.contents,
      ...this.files
        .list()
        .filter((other) => other.scopeId !== s.scopeId && within(s.root, other.root))
        .map((other) => path.relative(s.root, other.root).replaceAll('\\', '/')),
    ].map((p) => `:(top,exclude,literal)${p}`);
  }
  private async optional(s: Space, args: string[]) {
    try {
      return (await this.git(s, args)).trimEnd();
    } catch (error) {
      if (error instanceof GitError && [1, 128].includes(error.code ?? -1)) return '';
      throw error;
    }
  }
  private async config(s: Space, key: string) {
    return this.optional(s, ['config', '--get', key]);
  }
  private async gitDirectory(s: Space) {
    // Git resolves linked worktrees and separate administrative directories.
    return (await this.git(s, ['rev-parse', '--absolute-git-dir'])).trimEnd();
  }
  private async gitFile(directory: string, name: string) {
    try {
      return await fs.readFile(path.join(directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0);
      throw error;
    }
  }
  private async operation(directory: string): Promise<GitStatus['operation']> {
    for (const name of [
      'rebase-merge',
      'rebase-apply',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'sequencer',
    ]) {
      try {
        await fs.access(path.join(directory, name));
        return 'other';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return (await this.gitFile(directory, 'MERGE_HEAD')).length ? 'merge' : 'none';
  }
  private async remote(
    s: Space,
    branch?: string,
  ): Promise<{ value?: GitRemote; identity: string }> {
    if (!branch) return { identity: '' };
    const configured = await this.config(s, `branch.${branch}.remote`);
    const name = configured || 'origin';
    if (!/^[\w.-]+$/.test(name) || name === '.') return { identity: '' };
    if (!(await this.config(s, `remote.${name}.url`))) return { identity: '' };
    const url = await this.optional(s, ['remote', 'get-url', name]);
    if (!url) return { identity: '' };
    const pushes = (await this.git(s, ['remote', 'get-url', '--push', '--all', name]))
      .trimEnd()
      .split('\n');
    const mergeRef = await this.config(s, `branch.${branch}.merge`);
    const remoteBranch = mergeRef.startsWith('refs/heads/') ? mergeRef.slice(11) : branch;
    let tracking = await this.optional(s, ['rev-parse', '--symbolic-full-name', '@{upstream}']);
    const fallback = `refs/remotes/${name}/${remoteBranch}`;
    if (!tracking && (await this.optional(s, ['rev-parse', '--verify', fallback])))
      tracking = fallback;
    const repository = pushes.length === 1 ? githubRepository(pushes[0]) : undefined;
    const value = {
      name,
      label: repository ?? (pushes.length > 1 ? `${name}（複数の送信先）` : name),
      fetchLabel: githubRepository(url) ?? name,
      repository,
      branch: remoteBranch,
      tracking: tracking || undefined,
    };
    return { value, identity: JSON.stringify([value, url, pushes]) };
  }
  async status(id: string): Promise<GitStatus> {
    this.files.get(id);
    let s: Space;
    try {
      s = await this.root(id);
    } catch (error) {
      return {
        available: false,
        detail:
          error instanceof GitError
            ? 'Git リポジトリを確認できません。GitHub から取得するか、登録先・Git の設定を確認してください。'
            : (error as Error).message,
        changes: [],
        operation: 'none',
        version: '',
      };
    }
    // Do not run the generic onboarding inspection here: its unscoped status would scan contents.
    return this.snapshot(s);
  }
  private async snapshot(s: Space): Promise<GitStatus> {
    const directory = await this.gitDirectory(s);
    const [head, branch, index, op, mergeHead] = await Promise.all([
      this.optional(s, ['rev-parse', '--verify', 'HEAD']),
      this.optional(s, ['symbolic-ref', '--short', 'HEAD']),
      this.gitFile(directory, 'index'),
      this.operation(directory),
      this.gitFile(directory, 'MERGE_HEAD'),
    ]);
    const [raw, stagedRaw, remote] = await Promise.all([
      this.git(s, [
        'status',
        '--porcelain=v1',
        '-z',
        '--no-renames',
        '--untracked-files=all',
        '--ignore-submodules=none',
        '--',
        '.',
        ...this.exclusions(s),
      ]),
      this.git(s, ['diff', '--cached', '--name-status', '-z', ...diffOptions]),
      this.remote(s, branch || undefined),
    ]);
    const changes: GitChange[] = raw
      .split('\0')
      .filter(Boolean)
      .map((row) => ({
        path: row.slice(3),
        index: row[0],
        worktree: row[1],
        conflict: conflictCodes.has(row.slice(0, 2)),
      }));
    const staged = stagedRaw.split('\0');
    const paths = new Set(changes.map((change) => change.path));
    for (let i = 0; i + 1 < staged.length; i += 2)
      if (!paths.has(staged[i + 1]))
        changes.push({
          path: staged[i + 1],
          index: staged[i],
          worktree: ' ',
          conflict: staged[i] === 'U',
        });
    if (changes.length > 4000)
      throw Error('変更が 4,000 件を超えています。対象を整理してから開いてください。');
    for (const change of changes) {
      try {
        await this.safePath(s, change.path);
      } catch (error) {
        change.blocked = (error as Error).message;
      }
    }
    let ahead: number | undefined, behind: number | undefined;
    const trackingOid = remote.value?.tracking
      ? await this.optional(s, ['rev-parse', '--verify', remote.value.tracking])
      : '';
    if (head && trackingOid) {
      const counts = (
        await this.git(s, ['rev-list', '--left-right', '--count', `${head}...${trackingOid}`])
      )
        .trim()
        .split(/\s+/)
        .map(Number);
      [ahead, behind] = counts;
    }
    if (
      head !== (await this.optional(s, ['rev-parse', '--verify', 'HEAD'])) ||
      // Resolve again so a replaced .git pointer cannot hide an index change.
      hash(index) !== hash(await this.gitFile(await this.gitDirectory(s), 'index'))
    )
      throw stale();
    return {
      available: true,
      branch: branch || undefined,
      head: head || undefined,
      remote: remote.value,
      ahead,
      behind,
      operation: op,
      changes,
      version: hash(
        JSON.stringify([
          head,
          branch,
          hash(index),
          raw,
          stagedRaw,
          op,
          mergeHead.toString(),
          remote.identity,
          trackingOid,
        ]),
      ),
      fetchedAt: this.fetched.get(s.scopeId),
    };
  }
  private async checked(s: Space, version: string) {
    const status = await this.snapshot(s);
    if (status.version !== version) throw stale();
    return status;
  }
  private async working(s: Space, p: string): Promise<Buffer | undefined> {
    await this.safePath(s, p);
    try {
      const filename = path.join(s.root, p);
      if ((await fs.stat(filename)).size > 2 * 1024 * 1024)
        throw Error('このファイルは 2 MiB の差分・編集上限を超えています。');
      return await fs.readFile(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
  private text(bytes: Buffer) {
    if (bytes.includes(0)) throw Error('バイナリファイルです。');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  }
  async diff(id: string, p: string, staged: boolean): Promise<GitDiff> {
    const s = await this.root(id),
      state = await this.snapshot(s);
    const change = state.changes.find((c) => c.path === p);
    if (!change) throw stale();
    if (change.blocked) return { path: p, patch: change.blocked, version: state.version };
    const bytes = await this.working(s, p);
    let patch: string;
    if (change.index === '?' && !staged) {
      try {
        patch =
          `新規ファイル: ${p}\n` +
          this.text(bytes ?? Buffer.alloc(0))
            .split('\n')
            .map((line) => '+' + line)
            .join('\n');
      } catch {
        patch = '新規のバイナリファイルです。内容のテキスト表示はできません。';
      }
    } else
      patch = await this.git(s, [
        'diff',
        ...diffOptions,
        ...(staged ? ['--cached'] : []),
        '--',
        literal(p),
      ]);
    const after = await this.working(s, p);
    if (
      hash(bytes ?? '') !== hash(after ?? '') ||
      (await this.snapshot(s)).version !== state.version
    )
      throw stale();
    return {
      path: p,
      patch: patch || 'この側に差分はありません。',
      version: hash(state.version + '\0' + (bytes ? hash(bytes) : 'missing')),
    };
  }
  async stage(id: string, p: string, stage: boolean, version: string) {
    return this.mutate(id, async (s) => {
      const state = await this.snapshot(s),
        change = state.changes.find((c) => c.path === p);
      if (!change || change.conflict || state.operation === 'other')
        throw Error('競合を解決するか、進行中の Git 操作を完了してください。');
      if ((await this.diff(id, p, !stage)).version !== version) throw stale();
      this.validateName(p);
      if (stage) {
        if (change.blocked) throw Error(change.blocked);
        await this.safePath(s, p);
        await this.git(s, ['add', '-A', '--', literal(p)]);
      } else if (state.head)
        await this.git(s, ['restore', '--staged', '--source=HEAD', '--', literal(p)]);
      else await this.git(s, ['rm', '--cached', '--force', '--ignore-unmatch', '--', literal(p)]);
      return this.snapshot(s);
    });
  }
  async stageMany(id: string, paths: string[], stage: boolean, version: string) {
    return this.mutate(id, async (s) => {
      const state = await this.checked(s, version);
      if (!paths.length || paths.length > 4000 || state.operation === 'other') throw stale();
      const selected = [...new Set(paths)];
      for (const p of selected) {
        this.validateName(p);
        const change = state.changes.find((c) => c.path === p);
        if (!change || change.conflict) throw stale();
        if (stage) {
          if (change.blocked) throw Error(change.blocked);
          await this.safePath(s, p);
        }
      }
      // One native index transaction, with NUL pathspecs for long/Japanese/option-like names.
      await this.checked(s, version);
      const command = stage
        ? ['add', '-A']
        : state.head
          ? ['restore', '--staged', '--source=HEAD']
          : ['rm', '--cached', '--force', '--ignore-unmatch'];
      await this.git(s, [...command, '--pathspec-from-file=-', '--pathspec-file-nul'], {
        input: selected.map(literal).join('\0') + '\0',
      });
      return this.snapshot(s);
    });
  }
  async commit(id: string, message: string, version: string) {
    return this.mutate(id, async (s) => {
      const state = await this.checked(s, version);
      if (!message.trim() || message.length > 10000 || message.includes('\0'))
        throw Error('commit メッセージを入力してください。');
      if (!state.branch || state.operation === 'other' || state.changes.some((c) => c.conflict))
        throw Error('ブランチと未解決の競合を確認してください。');
      const staged = state.changes.filter((c) => ![' ', '?'].includes(c.index));
      if (!staged.length && state.operation !== 'merge')
        throw Error('commit 対象を選択してください。');
      for (const c of staged) if (c.blocked) throw Error(`${c.path}: ${c.blocked}`);
      await this.git(s, ['commit', '--file=-'], { input: message.trim() + '\n' });
      return this.snapshot(s);
    });
  }
  async history(id: string, offset = 0): Promise<GitHistory> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
      throw Error('履歴の範囲が不正です。');
    const s = await this.root(id);
    if (!(await this.optional(s, ['rev-parse', '--verify', 'HEAD'])))
      return { commits: [], more: false };
    const fields = (
      await this.git(s, [
        'log',
        '-z',
        '--no-show-signature',
        '--format=%H%x00%an%x00%aI%x00%s',
        `--skip=${offset}`,
        '--max-count=31',
        'HEAD',
        '--',
      ])
    ).split('\0');
    const commits = [];
    for (let i = 0; i + 3 < fields.length; i += 4)
      commits.push({
        oid: fields[i],
        author: fields[i + 1],
        date: fields[i + 2],
        subject: fields[i + 3],
      });
    return { commits: commits.slice(0, 30), more: commits.length > 30 };
  }
  async commitDiff(id: string, oid: string) {
    if (!oidPattern.test(oid)) throw Error('履歴の ID が不正です。');
    const s = await this.root(id);
    await this.git(s, ['merge-base', '--is-ancestor', oid, 'HEAD']);
    return this.git(s, [
      'show',
      '--format=fuller',
      '--no-show-signature',
      '--first-parent',
      ...diffOptions,
      oid,
      '--',
      '.',
      ...this.exclusions(s),
    ]);
  }
  private requireRemote(state: GitStatus) {
    if (!state.remote || !state.branch || !state.head)
      throw Error('ブランチ・リモート・最初の commit を確認してください。');
    return state.remote;
  }
  private async checkIncoming(s: Space, head: string, target: string) {
    const base = (await this.git(s, ['merge-base', head, target])).trim();
    const names = (
      await this.git(s, ['diff', '--name-only', '-z', '--no-renames', base, target, '--'])
    )
      .split('\0')
      .filter(Boolean);
    for (const p of names) {
      await this.safePath(s, p);
      if (p === '.irori/scope.json')
        throw Error(
          '受信内容にスペース定義の変更があります。登録情報への影響を確認してから取り込んでください。',
        );
    }
  }
  async sync(id: string, action: GitSyncAction, version: string) {
    return this.mutate(id, async (s) => {
      const state = await this.checked(s, version),
        remote = this.requireRemote(state);
      if (state.operation !== 'none' && action !== 'fetch')
        throw Error('進行中の Git 操作を完了してから同期してください。');
      if (action === 'push') {
        const urls = (await this.git(s, ['remote', 'get-url', '--push', '--all', remote.name]))
          .trimEnd()
          .split('\n');
        if (urls.length !== 1)
          throw Error('送信先が複数あります。Git のリモート設定を確認してください。');
        if ((await this.config(s, `remote.${remote.name}.mirror`)) === 'true')
          throw Error('ミラー設定のリモートにはこの画面から送信できません。');
        // Explicit source OID and one branch: configured push refspecs/tags cannot broaden publication.
        await this.git(
          s,
          [
            '-c',
            'push.followTags=false',
            'push',
            '--porcelain',
            '--no-force',
            '--no-recurse-submodules',
            remote.name,
            `${state.head}:refs/heads/${remote.branch}`,
          ],
          { network: true },
        );
      } else {
        if (action !== 'fetch' && state.changes.length)
          throw Error(
            'ローカルの変更を commit してから受信してください。未追跡ファイルも保持します。',
          );
        const ref = `refs/remotes/${remote.name}/${remote.branch}`;
        await this.git(s, ['check-ref-format', `refs/heads/${remote.branch}`]);
        await this.git(
          s,
          [
            'fetch',
            '--no-tags',
            '--no-recurse-submodules',
            remote.name,
            `+refs/heads/${remote.branch}:${ref}`,
          ],
          { network: true },
        );
        this.fetched.set(id, new Date().toISOString());
        if (action !== 'fetch') {
          const now = await this.snapshot(s);
          if (
            now.head !== state.head ||
            now.branch !== state.branch ||
            now.changes.length ||
            now.operation !== 'none'
          )
            throw stale();
          const target = (await this.git(s, ['rev-parse', '--verify', ref])).trim();
          await this.checkIncoming(s, state.head!, target);
          try {
            await this.git(s, [
              'merge',
              action === 'pull' ? '--ff-only' : '--no-ff',
              '--no-commit',
              '--no-autostash',
              '--no-overwrite-ignore',
              '--no-edit',
              target,
            ]);
          } catch (error) {
            if (
              action !== 'merge' ||
              (await this.operation(await this.gitDirectory(s))) !== 'merge'
            ) {
              if (action === 'pull' && error instanceof GitError)
                throw Error(
                  '履歴が分岐しているか、受信内容を適用できません。一覧を更新し「履歴を統合」を選んで双方を確認してください。',
                );
              throw error;
            }
          }
        }
      }
      return this.snapshot(s);
    });
  }
  async conflict(id: string, p: string): Promise<GitConflict> {
    const s = await this.root(id),
      state = await this.snapshot(s);
    await this.safePath(s, p);
    if (!state.changes.some((c) => c.path === p && c.conflict)) throw stale();
    const stages = (await this.git(s, ['ls-files', '--stage', '-z', '--', literal(p)]))
      .split('\0')
      .filter(Boolean)
      .map((line) => line.slice(0, line.indexOf('\t')).split(' '));
    const blobs: (Buffer | undefined)[] = [];
    let editable = state.operation === 'merge',
      detail = editable
        ? undefined
        : 'rebase・cherry-pick 等は開始した Git ツールで完了してください。';
    for (let stage = 1; stage <= 3; stage++) {
      const entry = stages.find((v) => v[2] === String(stage));
      if (!entry) {
        blobs.push(undefined);
        continue;
      }
      if (!['100644', '100755'].includes(entry[0])) {
        editable = false;
        detail = 'リンク・submodule の競合は外部の Git ツールで解決してください。';
        blobs.push(undefined);
        continue;
      }
      if (Number(await this.git(s, ['cat-file', '-s', entry[1]])) > 2 * 1024 * 1024) {
        editable = false;
        detail = '2 MiB を超える競合は外部の Git ツールで解決してください。';
        blobs.push(undefined);
        continue;
      }
      // Conflict editing is restricted to bounded UTF-8 regular-file blobs.
      const output = await this.git(s, ['cat-file', 'blob', entry[1]]);
      const bytes = Buffer.from(output);
      if (bytes.includes(0) || output.includes('\ufffd')) {
        editable = false;
        detail = 'バイナリ・UTF-8 以外の競合は外部の Git ツールで解決してください。';
      }
      blobs.push(bytes);
    }
    const working = await this.working(s, p);
    let workText: string | undefined;
    try {
      workText = working ? this.text(working) : undefined;
    } catch {
      editable = false;
      detail = '作業ファイルをテキストとして編集できません。外部の Git ツールで解決してください。';
    }
    if ((await this.snapshot(s)).version !== state.version) throw stale();
    return {
      path: p,
      base: blobs[0]?.toString('utf8'),
      ours: blobs[1]?.toString('utf8'),
      theirs: blobs[2]?.toString('utf8'),
      working: workText,
      version: hash(state.version + '\0' + (working ? hash(working) : 'missing')),
      editable,
      detail,
    };
  }
  async resolve(id: string, p: string, text: string | null, version: string) {
    return this.mutate(id, async (s) => {
      const conflict = await this.conflict(id, p);
      if (conflict.version !== version) throw stale();
      if (!conflict.editable) throw Error(conflict.detail);
      if (
        text !== null &&
        (Buffer.byteLength(text) > 2 * 1024 * 1024 ||
          text.includes('\0') ||
          /^(?:<{7}|={7}|>{7}|\|{7})(?: |$)/m.test(text))
      )
        throw Error('競合マーカーを取り除き、2 MiB 以下の統合内容を確認してください。');
      if (text === null && conflict.ours !== undefined && conflict.theirs !== undefined)
        throw Error('双方にあるファイルの削除はこの解決操作では選べません。');
      const backup = path.join(this.files.dataDir, 'git-recovery');
      await fs.mkdir(backup, { recursive: true, mode: 0o700 });
      await fs.writeFile(
        path.join(backup, randomUUID() + '.json'),
        JSON.stringify({ scopeId: id, ...conflict }),
        { flag: 'wx', mode: 0o600 },
      );
      if ((await this.conflict(id, p)).version !== version) throw stale();
      const filename = path.join(s.root, p);
      if (text === null) await fs.rm(filename, { force: true });
      else {
        const temp = path.join(path.dirname(filename), `.irori-git-${randomUUID()}.tmp`);
        const mode = await fs
          .stat(filename)
          .then((v) => v.mode)
          .catch(() => 0o644);
        try {
          await fs.writeFile(temp, text, { flag: 'wx', mode });
          await fs.rename(temp, filename);
        } finally {
          await fs.rm(temp, { force: true });
        }
      }
      await this.git(s, ['add', '-A', '--', literal(p)]);
      return this.snapshot(s);
    });
  }
  async repositoryURL(id: string) {
    const s = await this.root(id),
      state = await this.snapshot(s);
    const repository = state.remote?.repository;
    if (!repository) throw Error('GitHub のリポジトリ URL を確認できません。');
    return `https://github.com/${repository}`;
  }
  async clone(input: CloneRepository) {
    if (!this.canMutate() || this.busy) throw Error('実行中の処理の完了後に取得してください。');
    const repository = githubRepository(input.url);
    if (
      !repository ||
      !/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/.test(input.url) ||
      /[?#\s]/.test(input.url)
    )
      throw Error(
        'GitHub の HTTPS または SSH のリポジトリ URL を入力してください。認証情報を URL に含めないでください。',
      );
    if (
      !input.name.trim() ||
      input.name.length > 120 ||
      /[\\/:*?"<>|\x00-\x1f]/.test(input.name) ||
      input.name.startsWith('.') ||
      /[. ]$/.test(input.name)
    )
      throw Error('新しいフォルダ名を入力してください。');
    this.pending++;
    try {
      const parent = await fs.realpath(input.parent);
      if (!(await fs.stat(parent)).isDirectory())
        throw Error('保存先の親フォルダを選択してください。');
      for (const s of this.files.list()) {
        if (within(s.root, parent)) throw Error('登録済みスペースの外に保存先を選択してください。');
        for (const contents of s.contents) {
          const root = path.join(s.root, contents);
          const children = await fs.readdir(root).catch(() => [] as string[]);
          for (const candidate of [root, ...children.map((c) => path.join(root, c))]) {
            const actual = await fs.realpath(candidate).catch(() => undefined);
            if (actual && within(actual, parent))
              throw Error('クラウド資料の中にはリポジトリを取得できません。');
          }
        }
      }
      const destination = path.join(parent, input.name);
      try {
        await fs.mkdir(destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw Error('同じ名前のフォルダがあります。新しい名前を選択してください。');
        throw error;
      }
      try {
        await this.process.run(
          parent,
          ['clone', '--no-recurse-submodules', '--no-hardlinks', '--', input.url, destination],
          { network: true },
        );
      } catch (error) {
        throw Error(
          `${(error as Error).message} 取得途中のフォルダが残っている場合は保持しています。再試行時は別のフォルダ名を選択してください。`,
        );
      }
      return destination;
    } finally {
      this.pending--;
    }
  }
  async close() {
    await Promise.allSettled(this.queues.values());
    await this.process.close();
  }
}
