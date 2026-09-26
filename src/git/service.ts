import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileService, hash } from '../host/files';
import { githubRepository } from '../host/workspaces';
import { classify, owner, within } from '../domain/scopes';
import { lineRanges } from '../domain/knowledge';
import { lineKey, type AuthorshipStore } from '../knowledge/authorship';
import type { Space } from '../domain/types';
import type {
  CloneRepository,
  CloneResult,
  GitChange,
  GitConflict,
  GitDiff,
  GitHistory,
  GitRemote,
  GitStatus,
  GitSyncAction,
} from '../domain/git';
import { GitError, GitProcess } from './process';
import { t } from '../domain/i18n';
import {
  formatNote,
  humanId,
  isHuman,
  notesRef,
  parseNote,
  rangeLines,
  schemaVersion,
  type Note,
  type NoteFile,
} from './notes';

const literal = (name: string) => `:(top,literal)${name}`;
const oidPattern = /^[a-f0-9]{40,64}$/;
const conflictCodes = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const diffOptions = ['--no-ext-diff', '--no-textconv', '--no-renames', '--no-color'];
const stale = () =>
  Error(
    t(
      '確認後に Git またはファイルが変更されました。一覧・差分を更新してから再試行してください。',
      'Git or the files changed after this was checked. Refresh the list and diff, then try again.',
    ),
  );

export class GitService {
  private queues = new Map<string, Promise<unknown>>();
  private pending = 0;
  private fetched = new Map<string, string>();
  constructor(
    private files: FileService,
    private canMutate: () => boolean = () => true,
    private authorship?: Pick<AuthorshipStore, 'view'>,
    private process = new GitProcess(),
  ) {}
  get busy() {
    return this.pending > 0;
  }
  private git(s: Pick<Space, 'root'>, args: string[], options?: Parameters<GitProcess['run']>[2]) {
    return this.process.run(s.root, args, options);
  }
  private async root(id: string) {
    const s = this.files.get(id);
    if ((await fs.realpath(s.root)) !== s.root)
      throw Error(
        t(
          'スペースの配置が変更されました。登録先を確認してください。',
          "The space's location has changed. Check where it is registered.",
        ),
      );
    const gitRoot = (await this.git(s, ['rev-parse', '--show-toplevel'])).trimEnd();
    if ((await fs.realpath(gitRoot)) !== s.root)
      throw Error(
        t(
          'Git 操作にはリポジトリのルートを登録してください。',
          "Register the repository's root for Git operations.",
        ),
      );
    return s;
  }
  private mutate<T>(id: string, fn: (s: Space) => Promise<T>): Promise<T> {
    if (!this.canMutate())
      return Promise.reject(
        Error(
          t(
            '保存・エージェント・接続処理の完了後に Git 操作を再試行してください。',
            'Try the Git operation again after saving, agent, and connection work finishes.',
          ),
        ),
      );
    const key = this.files.get(id).root;
    this.pending++;
    const next = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.canMutate())
          throw Error(
            t(
              '別の処理が実行中です。完了後に再試行してください。',
              'Another operation is running. Try again once it finishes.',
            ),
          );
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
      throw Error(t('この Git パスは操作できません。', 'This Git path cannot be used.'));
  }
  private boundary(s: Space, p: string) {
    this.validateName(p);
    const target = path.join(s.root, p);
    if (classify(s, p) === 'contents')
      throw Error(
        t('クラウド資料は Git の対象にできません。', 'Cloud materials cannot be a Git target.'),
      );
    if (owner(this.files.list(), target)?.scopeId !== s.scopeId)
      throw Error(t('別のスペースが所有するファイルです。', 'This file belongs to another space.'));
  }
  private async safePath(s: Space, p: string) {
    this.boundary(s, p);
    const segments = p.split('/');
    let current = s.root;
    for (const segment of segments) {
      current = path.join(current, segment);
      try {
        const info = await fs.lstat(current);
        if (info.isSymbolicLink())
          throw Error(
            t(
              'リンクを経由する Git 操作には対応していません。',
              'Git operations through a link are not supported.',
            ),
          );
        if (current === path.join(s.root, p) && info.isDirectory())
          throw Error(
            t(
              'ディレクトリ・submodule は所有するリポジトリ側で操作してください。',
              'Operate on directories and submodules from their owning repository.',
            ),
          );
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
  private async optional(s: Pick<Space, 'root'>, args: string[]) {
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
  private async blob(s: Space, name: string) {
    try {
      return await this.git(s, ['cat-file', 'blob', name]);
    } catch (error) {
      if (error instanceof GitError && error.code === 128) return;
      throw error;
    }
  }
  private ref(s: Pick<Space, 'root'>, name: string) {
    return this.optional(s, ['rev-parse', '--verify', '-q', name]);
  }
  /**
   * The lines of this note that the repository's authorship notes name as a
   * person's, keyed by line text like the device record so that a line stays
   * the person's wherever it has moved since. A note names lines by number in
   * the file as that commit had it, so each noted commit's version is read.
   */
  async noted(id: string, p: string): Promise<Set<string>> {
    const s = await this.root(id);
    this.validateName(p);
    const found = new Set<string>();
    const records = (
      await this.optional(s, [
        'log',
        '-z',
        '--follow',
        '--find-renames',
        '--name-status',
        '--no-ext-diff',
        '--no-textconv',
        '--no-notes',
        `--notes=${notesRef}`,
        '--format=%H%x00%N',
        '--max-count=50',
        'HEAD',
        '--',
        literal(p),
      ])
    ).split('\0');
    let currentPath = p;
    for (let i = 0; i + 1 < records.length;) {
      const oid = records[i++],
        note = parseNote(records[i++]),
        at = currentPath;
      // Name-status fields are NUL-delimited too: consume path fields with
      // their status, so a filename shaped like a commit SHA stays a filename.
      while (i < records.length && !oidPattern.test(records[i])) {
        const status = records[i++].trim();
        if (!status) continue;
        const previous = records[i++];
        if (/^[RC]\d+$/.test(status)) {
          const next = records[i++];
          if (next === currentPath) currentPath = previous;
        }
      }
      if (!oidPattern.test(oid) || !note) continue;
      const entries = note.files
        .filter((f) => f.path === at)
        .flatMap((f) => f.entries)
        .filter((entry) => isHuman(entry.key));
      if (!entries.length) continue;
      const lines = ((await this.blob(s, `${oid}:${at}`)) ?? '').split('\n');
      for (const entry of entries)
        for (const n of rangeLines(entry.ranges, lines.length)) {
          const key = lineKey(lines[n - 1]);
          if (key) found.add(key);
        }
    }
    return found;
  }
  /**
   * Attaches the standard's note to a commit irori just made, naming as the
   * committer's (`h_`) the lines this device saw the person write or revise.
   * Nothing else is claimed: an agent's line and one that arrived by pull stay
   * unattested. A note another tool already attached keeps every entry it had,
   * with irori's after them, and the write is refused rather than forced when
   * the notes ref has moved in between.
   */
  private async attest(s: Space, oid: string): Promise<string | undefined> {
    if (!this.authorship) return;
    const changed = (
      await this.git(s, [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '-r',
        '--name-only',
        '-z',
        '--no-renames',
        '--diff-filter=AM',
        oid,
      ])
    )
      .split('\0')
      .filter((p) => p.endsWith('.md') && !p.includes('\n') && classify(s, p) === 'Knowledge_Base');
    const identity = (await this.git(s, ['log', '-1', '--format=%cn <%ce>', oid])).trim(),
      key = humanId(identity),
      files: NoteFile[] = [];
    for (const p of changed) {
      const text = await this.blob(s, `${oid}:${p}`);
      if (text === undefined) continue;
      const view = await this.authorship.view({ scopeId: s.scopeId, path: p }, text);
      const lines = view.lines.flatMap((mine, index) => (mine ? [index + 1] : []));
      if (lines.length) files.push({ path: p, entries: [{ key, ranges: lineRanges(lines, ',') }] });
    }
    if (!files.length) return;
    const tip = await this.ref(s, notesRef),
      existing = await this.optional(s, ['notes', `--ref=${notesRef}`, 'show', oid]),
      humans = { [key]: { author: identity } };
    let note: Note = {
      files,
      metadata: { schema_version: schemaVersion, base_commit_sha: oid, prompts: {}, humans },
    };
    if (existing) {
      const theirs = parseNote(existing);
      if (!theirs)
        return t(
          '既存の作者情報ノート（refs/notes/ai）を読めないため、この commit には追記しませんでした。',
          'Could not read the existing authorship note (refs/notes/ai), so nothing was added to this commit.',
        );
      for (const file of files) {
        const own = theirs.files.find((f) => f.path === file.path);
        // git-ai reads a file's entries last first, so the person's come last.
        if (own) own.entries = [...own.entries.filter((e) => e.key !== key), ...file.entries];
        else theirs.files.push(file);
      }
      const known = theirs.metadata.humans;
      theirs.metadata.humans = {
        ...(known && typeof known === 'object' && !Array.isArray(known) ? known : {}),
        ...humans,
      };
      theirs.metadata.prompts ??= {};
      note = theirs;
    }
    const content = formatNote(note),
      message = 'Authorship note from irori';
    try {
      // fast-import is how git-ai writes notes too, and it refuses to move the
      // ref unless the new tip contains the current one.
      await this.git(s, ['fast-import', '--quiet', '--done'], {
        input:
          `commit ${notesRef}\ncommitter irori <irori@local> ${Math.floor(Date.now() / 1000)} +0000\n` +
          `data ${Buffer.byteLength(message)}\n${message}\n` +
          (tip ? `from ${tip}\n` : '') +
          `N inline ${oid}\ndata ${Buffer.byteLength(content)}\n${content}\ndone\n`,
      });
    } catch {
      return t(
        '作者情報ノート（refs/notes/ai）を書き込めませんでした。別のツールが更新中の可能性があります。',
        'Could not write the authorship note (refs/notes/ai). Another tool may be updating it.',
      );
    }
  }
  /**
   * Notes travel the way git-ai carries them: fetched into the tracking ref it
   * uses, then merged keeping this side's version of any note both changed, so
   * the two tools agree about a repository they share.
   */
  private async fetchNotes(
    s: Pick<Space, 'root'>,
    remoteName: string,
  ): Promise<string | undefined> {
    const tracking = `refs/notes/ai-remote/${remoteName.replace(/[^\w-]/g, '_')}`;
    try {
      // Missing notes are normal; a transport failure is not. Discover the
      // exact ref first, since `fetch` reports both with the same exit code.
      const advertised = await this.git(s, ['ls-remote', '--refs', remoteName, notesRef], {
        network: true,
      });
      if (!advertised.trim()) return;
      await this.git(
        s,
        ['fetch', '--no-tags', '--no-recurse-submodules', remoteName, `+${notesRef}:${tracking}`],
        { network: true },
      );
    } catch {
      return t(
        'リポジトリの取得は完了しましたが、作者情報ノート（refs/notes/ai）を受信できませんでした。ソース管理の Fetch で再試行してください。',
        'The repository was cloned, but the authorship note (refs/notes/ai) could not be received. Retry with Fetch in Source control.',
      );
    }
    try {
      if (!(await this.ref(s, tracking))) return;
      if (!(await this.ref(s, notesRef))) {
        await this.git(s, ['update-ref', notesRef, tracking]);
        return;
      }
      await this.git(s, ['notes', `--ref=${notesRef}`, 'merge', '-s', 'ours', '--quiet', tracking]);
    } catch {
      return t(
        '受信した作者情報ノート（refs/notes/ai）を統合できませんでした。',
        'Could not merge the received authorship note (refs/notes/ai).',
      );
    }
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
      label:
        repository ??
        (pushes.length > 1
          ? t(`${name}（複数の送信先）`, `${name} (multiple push destinations)`)
          : name),
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
            ? t(
                'Git リポジトリを確認できません。GitHub から取得するか、登録先・Git の設定を確認してください。',
                'Could not find a Git repository. Clone it from GitHub, or check where it is registered and its Git configuration.',
              )
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
      throw Error(
        t(
          '変更が 4,000 件を超えています。対象を整理してから開いてください。',
          'There are more than 4,000 changes. Reduce the scope before opening it.',
        ),
      );
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
        throw Error(
          t(
            'このファイルは 2 MiB の差分・編集上限を超えています。',
            'This file exceeds the 2 MiB diff and edit limit.',
          ),
        );
      return await fs.readFile(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
  private text(bytes: Buffer) {
    if (bytes.includes(0)) throw Error(t('バイナリファイルです。', 'This is a binary file.'));
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
          t(`新規ファイル: ${p}\n`, `New file: ${p}\n`) +
          this.text(bytes ?? Buffer.alloc(0))
            .split('\n')
            .map((line) => '+' + line)
            .join('\n');
      } catch {
        patch = t(
          '新規のバイナリファイルです。内容のテキスト表示はできません。',
          'This is a new binary file. Its contents cannot be shown as text.',
        );
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
      patch: patch || t('この側に差分はありません。', 'There is no difference on this side.'),
      version: hash(state.version + '\0' + (bytes ? hash(bytes) : 'missing')),
    };
  }
  async stage(id: string, p: string, stage: boolean, version: string) {
    return this.mutate(id, async (s) => {
      const state = await this.snapshot(s),
        change = state.changes.find((c) => c.path === p);
      if (!change || change.conflict || state.operation === 'other')
        throw Error(
          t(
            '競合を解決するか、進行中の Git 操作を完了してください。',
            'Resolve the conflict, or finish the Git operation in progress.',
          ),
        );
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
        throw Error(t('commit メッセージを入力してください。', 'Enter a commit message.'));
      if (!state.branch || state.operation === 'other' || state.changes.some((c) => c.conflict))
        throw Error(
          t(
            'ブランチと未解決の競合を確認してください。',
            'Check the branch and any unresolved conflicts.',
          ),
        );
      const staged = state.changes.filter((c) => ![' ', '?'].includes(c.index));
      if (!staged.length && state.operation !== 'merge')
        throw Error(t('commit 対象を選択してください。', 'Select what to commit.'));
      for (const c of staged) if (c.blocked) throw Error(`${c.path}: ${c.blocked}`);
      await this.git(s, ['commit', '--file=-'], { input: message.trim() + '\n' });
      // The commit stands whatever happens to its note.
      const notice = await this.attest(s, await this.ref(s, 'HEAD')).catch(() =>
        t(
          '作者情報ノート（refs/notes/ai）を書き込めませんでした。',
          'Could not write the authorship note (refs/notes/ai).',
        ),
      );
      const status = await this.snapshot(s);
      return notice ? { ...status, notice } : status;
    });
  }
  async history(id: string, offset = 0): Promise<GitHistory> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
      throw Error(t('履歴の範囲が不正です。', 'The history range is invalid.'));
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
    if (!oidPattern.test(oid))
      throw Error(t('履歴の ID が不正です。', 'The history ID is invalid.'));
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
      throw Error(
        t(
          'ブランチ・リモート・最初の commit を確認してください。',
          'Check the branch, remote, and first commit.',
        ),
      );
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
          t(
            '受信内容にスペース定義の変更があります。登録情報への影響を確認してから取り込んでください。',
            'The incoming content changes the space definition. Check its effect on the registration before merging it in.',
          ),
        );
    }
  }
  async sync(id: string, action: GitSyncAction, version: string) {
    return this.mutate(id, async (s) => {
      const state = await this.checked(s, version),
        remote = this.requireRemote(state);
      if (state.operation !== 'none' && action !== 'fetch')
        throw Error(
          t(
            '進行中の Git 操作を完了してから同期してください。',
            'Finish the Git operation in progress before syncing.',
          ),
        );
      let notice: string | undefined;
      if (action === 'push') {
        const urls = (await this.git(s, ['remote', 'get-url', '--push', '--all', remote.name]))
          .trimEnd()
          .split('\n');
        if (urls.length !== 1)
          throw Error(
            t(
              '送信先が複数あります。Git のリモート設定を確認してください。',
              'There are multiple push destinations. Check the Git remote configuration.',
            ),
          );
        if ((await this.config(s, `remote.${remote.name}.mirror`)) === 'true')
          throw Error(
            t(
              'ミラー設定のリモートにはこの画面から送信できません。',
              'A mirrored remote cannot be pushed to from this screen.',
            ),
          );
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
        // The notes follow the branch, never forced: a rejection means another
        // device's notes are not merged here yet, which Fetch does.
        if (await this.ref(s, notesRef))
          try {
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
                `${notesRef}:${notesRef}`,
              ],
              { network: true },
            );
          } catch {
            notice = t(
              '作者情報ノート（refs/notes/ai）は送信されませんでした。Fetch で受信・統合してから再度 Push してください。',
              'The authorship note (refs/notes/ai) was not pushed. Fetch to receive and merge it, then push again.',
            );
          }
      } else {
        if (action !== 'fetch' && state.changes.length)
          throw Error(
            t(
              'ローカルの変更を commit してから受信してください。未追跡ファイルも保持します。',
              'Commit local changes before receiving. Untracked files are kept too.',
            ),
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
        notice = await this.fetchNotes(s, remote.name);
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
                  t(
                    '履歴が分岐しているか、受信内容を適用できません。一覧を更新し「履歴を統合」を選んで双方を確認してください。',
                    'The history has diverged, or the incoming content cannot be applied. Refresh the list and choose "Merge history" to review both sides.',
                  ),
                );
              throw error;
            }
          }
        }
      }
      const status = await this.snapshot(s);
      return notice ? { ...status, notice } : status;
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
        : t(
            'rebase・cherry-pick 等は開始した Git ツールで完了してください。',
            'Finish rebase, cherry-pick, and similar operations in the Git tool that started them.',
          );
    for (let stage = 1; stage <= 3; stage++) {
      const entry = stages.find((v) => v[2] === String(stage));
      if (!entry) {
        blobs.push(undefined);
        continue;
      }
      if (!['100644', '100755'].includes(entry[0])) {
        editable = false;
        detail = t(
          'リンク・submodule の競合は外部の Git ツールで解決してください。',
          'Resolve link and submodule conflicts in an external Git tool.',
        );
        blobs.push(undefined);
        continue;
      }
      if (Number(await this.git(s, ['cat-file', '-s', entry[1]])) > 2 * 1024 * 1024) {
        editable = false;
        detail = t(
          '2 MiB を超える競合は外部の Git ツールで解決してください。',
          'Resolve conflicts over 2 MiB in an external Git tool.',
        );
        blobs.push(undefined);
        continue;
      }
      // Conflict editing is restricted to bounded UTF-8 regular-file blobs.
      const output = await this.git(s, ['cat-file', 'blob', entry[1]]);
      const bytes = Buffer.from(output);
      if (bytes.includes(0) || output.includes('\ufffd')) {
        editable = false;
        detail = t(
          'バイナリ・UTF-8 以外の競合は外部の Git ツールで解決してください。',
          'Resolve binary and non-UTF-8 conflicts in an external Git tool.',
        );
      }
      blobs.push(bytes);
    }
    const working = await this.working(s, p);
    let workText: string | undefined;
    try {
      workText = working ? this.text(working) : undefined;
    } catch {
      editable = false;
      detail = t(
        '作業ファイルをテキストとして編集できません。外部の Git ツールで解決してください。',
        'The working file cannot be edited as text. Resolve it in an external Git tool.',
      );
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
        throw Error(
          t(
            '競合マーカーを取り除き、2 MiB 以下の統合内容を確認してください。',
            'Remove the conflict markers and check that the merged content is 2 MiB or smaller.',
          ),
        );
      if (text === null && conflict.ours !== undefined && conflict.theirs !== undefined)
        throw Error(
          t(
            '双方にあるファイルの削除はこの解決操作では選べません。',
            'A file present on both sides cannot be resolved as a deletion here.',
          ),
        );
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
    if (!repository)
      throw Error(
        t(
          'GitHub のリポジトリ URL を確認できません。',
          'Could not determine the GitHub repository URL.',
        ),
      );
    return `https://github.com/${repository}`;
  }
  async clone(input: CloneRepository): Promise<CloneResult> {
    if (!this.canMutate() || this.busy)
      throw Error(
        t(
          '実行中の処理の完了後に取得してください。',
          'Clone after the operation in progress finishes.',
        ),
      );
    const repository = githubRepository(input.url);
    if (
      !repository ||
      !/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/.test(input.url) ||
      /[?#\s]/.test(input.url)
    )
      throw Error(
        t(
          'GitHub の HTTPS または SSH のリポジトリ URL を入力してください。認証情報を URL に含めないでください。',
          'Enter a GitHub HTTPS or SSH repository URL. Do not include credentials in the URL.',
        ),
      );
    if (
      !input.name.trim() ||
      input.name.length > 120 ||
      /[\\/:*?"<>|\x00-\x1f]/.test(input.name) ||
      input.name.startsWith('.') ||
      /[. ]$/.test(input.name)
    )
      throw Error(t('新しいフォルダ名を入力してください。', 'Enter a name for the new folder.'));
    this.pending++;
    try {
      const parent = await fs.realpath(input.parent);
      if (!(await fs.stat(parent)).isDirectory())
        throw Error(
          t('保存先の親フォルダを選択してください。', 'Select the parent folder to save into.'),
        );
      for (const s of this.files.list()) {
        if (within(s.root, parent))
          throw Error(
            t(
              '登録済みスペースの外に保存先を選択してください。',
              'Select a destination outside registered spaces.',
            ),
          );
        for (const contents of s.contents) {
          const root = path.join(s.root, contents);
          const children = await fs.readdir(root).catch(() => [] as string[]);
          for (const candidate of [root, ...children.map((c) => path.join(root, c))]) {
            const actual = await fs.realpath(candidate).catch(() => undefined);
            if (actual && within(actual, parent))
              throw Error(
                t(
                  'クラウド資料の中にはリポジトリを取得できません。',
                  'A repository cannot be cloned inside cloud materials.',
                ),
              );
          }
        }
      }
      const destination = path.join(parent, input.name);
      try {
        await fs.mkdir(destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw Error(
            t(
              '同じ名前のフォルダがあります。新しい名前を選択してください。',
              'A folder with this name already exists. Choose a different name.',
            ),
          );
        throw error;
      }
      try {
        await this.process.run(
          parent,
          [
            'clone',
            '--origin',
            'origin',
            '--no-recurse-submodules',
            '--no-hardlinks',
            '--',
            input.url,
            destination,
          ],
          { network: true },
        );
      } catch (error) {
        // Git empties a destination that existed before the clone, so the folder irori
        // created is removed only while it is still empty; anything left in it is kept.
        const kept = await fs.rmdir(destination).then(
          () => false,
          () => true,
        );
        if (!kept) throw error;
        const [advice, ...detail] = (error as Error).message.split('\n\n');
        throw Error(
          [
            `${advice}\n${t(
              '取得途中のフォルダを保持しています。再試行時は別のフォルダ名を選択してください。',
              'The partially cloned folder is kept. Choose a different folder name when retrying.',
            )}`,
            ...detail,
          ].join('\n\n'),
        );
      }
      const notice = await this.fetchNotes({ root: destination }, 'origin');
      return { path: destination, notice };
    } finally {
      this.pending--;
    }
  }
  async close() {
    await Promise.allSettled(this.queues.values());
    await this.process.close();
  }
}
