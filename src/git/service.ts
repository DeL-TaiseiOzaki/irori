import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileService, hash } from '../host/files';
import { replaceFile } from '../host/local-json';
import { githubRepository } from '../host/workspaces';
import { classify, owner, within } from '../domain/scopes';
import { lineRanges } from '../domain/knowledge';
import { lineKey, type AuthorshipStore } from '../knowledge/authorship';
import type { Space } from '../domain/types';
import type {
  CloneRepository,
  CloneResult,
  CreateSpace,
  PublishRepository,
  GitChange,
  GitConflict,
  GitDiff,
  GitHistory,
  GitRemote,
  GitStatus,
  GitSyncAction,
  GitTarget,
  GitSubmodule,
  GitSubmodules,
  AddSubmodule,
} from '../domain/git';
import { gitRepository, gitScope } from '../domain/git';
import { GitError, GitProcess } from './process';
import { GitHubCli } from './github';
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

/**
 * A repository a hibachi holds: its own checkout (`prefix` empty) or a submodule
 * at `prefix` inside it. Paths Git reports are relative to `root`; the hibachi's
 * layers and ownership are decided on `prefix + path` against `space`.
 */
type Repo = Space & { prefix: string; space: Space };
const main = (space: Space): Repo => ({ ...space, prefix: '', space });
/** A GitHub repository over HTTPS or SSH, the only remotes irori clones from. */
export function githubCloneURL(url: string) {
  return (
    !!githubRepository(url) &&
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/.test(url) &&
    !/[?#\s]/.test(url)
  );
}
const cloneURLRequired = () =>
  Error(
    t(
      'GitHub の HTTPS または SSH のリポジトリ URL を入力してください。',
      'Enter a GitHub HTTPS or SSH repository URL.',
    ),
  );
const literal = (name: string) => `:(top,literal)${name}`;
const oidPattern = /^[a-f0-9]{40,64}$/;
const conflictCodes = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const diffOptions = ['--no-ext-diff', '--no-textconv', '--no-renames', '--no-color'];
const stale = () =>
  Error(
    t(
      '確認後に Git またはファイルが変更されました。',
      'Git or the files changed after this was checked.',
    ),
  );

export class GitService {
  private queues = new Map<string, Promise<unknown>>();
  private pending = 0;
  private fetched = new Map<string, string>();
  private statuses = new Map<
    string,
    { result: Promise<GitStatus>; started: boolean; followup: boolean }
  >();
  private mutationRefreshes = new Map<string, { root: string; target: GitTarget }>();
  private closing = false;
  private revisions = new Map<string, number>();
  private noting = new Map<string, Promise<Set<string>>>();
  private notedCache = new Map<string, { revision: string; keys: Set<string> }>();
  constructor(
    private files: FileService,
    private canMutate: () => boolean = () => true,
    private authorship?: Pick<AuthorshipStore, 'view'>,
    private process = new GitProcess(),
    private github = new GitHubCli(),
    /** Where a submodule may come from, and the transports Git may use to fetch it. */
    private submoduleRemotes = { accepts: githubCloneURL, protocols: ['https', 'ssh'] },
  ) {}
  get busy() {
    return this.pending > 0;
  }
  private git(s: Pick<Space, 'root'>, args: string[], options?: Parameters<GitProcess['run']>[2]) {
    return this.process.run(s.root, args, options);
  }
  private async repo(target: GitTarget): Promise<Repo> {
    const s = this.files.get(gitScope(target));
    if ((await fs.realpath(s.root)) !== s.root)
      throw Error(t('スペースの配置が変更されました。', "The space's location has changed."));
    const repository = gitRepository(target);
    const root = repository ? path.join(s.root, repository) : s.root;
    if (repository) {
      this.boundary(main(s), repository);
      if (!(await this.submodulePaths(main(s))).has(repository))
        throw Error(
          t(
            'この hibachi の submodule ではありません。',
            'This is not a submodule of the hibachi.',
          ),
        );
      try {
        if ((await fs.realpath(root)) !== root) throw Error('alias');
      } catch {
        throw Error(
          t('submodule のフォルダを確認できません。', "Could not check the submodule's folder."),
        );
      }
      if (!(await this.initialized(root)))
        throw Error(
          t(
            'この submodule はまだ取得されていません。',
            'This submodule has not been fetched yet.',
          ),
        );
    }
    const gitRoot = (await this.git({ root }, ['rev-parse', '--show-toplevel'])).trimEnd();
    if ((await fs.realpath(gitRoot)) !== root)
      throw Error(
        t('リポジトリのルートが登録されていません。', "The repository's root is not registered."),
      );
    return { ...s, root, prefix: repository ? repository + '/' : '', space: s };
  }
  /** A submodule's files are here: its folder is a checkout of its own. */
  private async initialized(root: string) {
    try {
      await fs.lstat(path.join(root, '.git'));
      const top = await this.optional({ root }, ['rev-parse', '--show-toplevel']);
      return !!top && (await fs.realpath(top)) === root;
    } catch {
      return false;
    }
  }
  /**
   * The submodules `.gitmodules` declares, by name. A declaration whose path is
   * unusable (outside the hibachi, a Git path, a link) is left out.
   */
  private async declared(s: Repo) {
    const file = path.join(s.root, '.gitmodules');
    try {
      if (!(await fs.lstat(file)).isFile()) return [];
    } catch {
      return [];
    }
    const read = async (key: string) =>
      new Map(
        (await this.optional(s, ['config', '--file', '.gitmodules', '-z', '--get-regexp', key]))
          .split('\0')
          .filter(Boolean)
          .map((entry) => {
            const end = entry.indexOf('\n');
            return [entry.slice(0, end), entry.slice(end + 1)] as const;
          }),
      );
    const [paths, urls, branches] = await Promise.all([
      read('^submodule\\..*\\.path$'),
      read('^submodule\\..*\\.url$'),
      read('^submodule\\..*\\.branch$'),
    ]);
    const found: { name: string; path: string; url: string; branch: string }[] = [];
    for (const [key, value] of paths) {
      const name = key.slice('submodule.'.length, -'.path'.length);
      const p = value.replace(/\/+$/, '');
      try {
        this.boundary(s, p);
      } catch {
        continue;
      }
      found.push({
        name,
        path: p,
        url: urls.get(`submodule.${name}.url`) ?? '',
        branch: branches.get(`submodule.${name}.branch`) ?? '',
      });
    }
    return found;
  }
  /**
   * The declared submodules the index also records as submodule commits
   * (gitlinks). Only the declared paths are listed, so a large index is not read.
   */
  private async recorded(s: Repo) {
    if (s.prefix) return [];
    const declared = await this.declared(s);
    if (!declared.length) return [];
    const links = new Set(
      (
        await this.optional(s, [
          'ls-files',
          '--stage',
          '-z',
          '--',
          ...declared.map((m) => literal(m.path)),
        ])
      )
        .split('\0')
        .filter((row) => row.startsWith('160000 '))
        .map((row) => row.slice(row.indexOf('\t') + 1)),
    );
    return declared.filter((m) => links.has(m.path));
  }
  /** A hibachi's submodules: declared in `.gitmodules` and recorded in its index. */
  private async submodulePaths(s: Repo) {
    return new Set((await this.recorded(s)).map((m) => m.path));
  }
  /**
   * `fresh`: the repository is a hibachi just made in a new folder, which no
   * run, save or connection can be working in, so it waits for none of them.
   */
  private mutate<T>(
    id: GitTarget,
    fn: (s: Repo) => Promise<T>,
    resolve: (id: GitTarget) => Promise<Repo> = (id) => this.repo(id),
    fresh = false,
  ): Promise<T> {
    if (!fresh && !this.canMutate())
      return Promise.reject(
        Error(
          t(
            '保存・エージェント・ルーティン・接続処理の完了後に Git 操作ができます。',
            'Git operations are available after saving, agent, routine and connection work finishes.',
          ),
        ),
      );
    // A hibachi's submodules queue with it: committing one moves what the hibachi records.
    const key = this.files.get(gitScope(id)).root;
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    this.pending++;
    const next = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!fresh && !this.canMutate())
          throw Error(t('別の処理が実行中です。', 'Another operation is running.'));
        return fn(await resolve(id));
      });
    this.queues.set(key, next);
    return next.finally(() => {
      this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
      this.pending--;
      if (this.queues.get(key) === next) {
        this.queues.delete(key);
        for (const [statusKey, refresh] of this.mutationRefreshes) {
          if (refresh.root !== key) continue;
          this.mutationRefreshes.delete(statusKey);
          if (!this.closing) void this.status(refresh.target).catch(() => {});
        }
      }
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
  private boundary(s: Repo, p: string) {
    this.validateName(p);
    const target = path.join(s.root, p);
    if (classify(s.space, s.prefix + p) === 'contents')
      throw Error(
        t('クラウド資料は Git の対象にできません。', 'Cloud materials cannot be a Git target.'),
      );
    // A clone not registered yet is owned by no space, and its scope ID is empty.
    if ((owner(this.files.list(), target)?.scopeId ?? '') !== s.scopeId)
      throw Error(t('別のスペースが所有するファイルです。', 'This file belongs to another space.'));
  }
  /** `gitlinks` are the submodule paths this repository may name as a whole. */
  private async safePath(s: Repo, p: string, gitlinks?: Set<string>) {
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
        if (current === path.join(s.root, p) && info.isDirectory() && !gitlinks?.has(p))
          throw Error(
            t(
              'ディレクトリ・submodule はこのリポジトリでは操作できません。',
              'Directories and submodules cannot be operated on from this repository.',
            ),
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  private exclusions(s: Repo) {
    return [
      // Contents are declared from the hibachi's root; a submodule sees those inside it.
      ...s.space.contents.flatMap((c) =>
        !s.prefix ? [c] : c.startsWith(s.prefix) ? [c.slice(s.prefix.length)] : [],
      ),
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
  /** The person's Git author email for this space's checkout, or '' when unset. */
  async userEmail(id: string): Promise<string> {
    return this.config(main(this.files.get(id)), 'user.email');
  }
  private async config(s: Repo, key: string) {
    return this.optional(s, ['config', '--get', key]);
  }
  private async blob(s: Repo, name: string) {
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
  async noted(id: string, notePath: string): Promise<Set<string>> {
    const root = this.files.get(id).root;
    const key = JSON.stringify([root, notePath]);
    const pending = this.noting.get(key);
    if (pending) return pending.then((keys) => new Set(keys));
    // Attestation calls back here from inside commit; it cannot wait on the
    // mutation queue. readNoted checks the history refs before publishing.
    const next = this.readNoted(id, notePath, key).finally(() => this.noting.delete(key));
    this.noting.set(key, next);
    return next.then((keys) => new Set(keys));
  }
  private async readNoted(id: string, notePath: string, key: string): Promise<Set<string>> {
    this.validateName(notePath);
    // A note inside a submodule has its history, and its notes, in that repository.
    const hibachi = main(this.files.get(id));
    const repository = [...(await this.submodulePaths(hibachi))].find((m) =>
      notePath.startsWith(m + '/'),
    );
    const s = await this.repo(repository ? { scopeId: id, repository } : id);
    const p = notePath.slice(s.prefix.length);
    for (;;) {
      // Authorship notes can move without HEAD moving, including a notes-only fetch.
      const [head, notes] = await Promise.all([this.ref(s, 'HEAD'), this.ref(s, notesRef)]);
      const revision = JSON.stringify([s.root, p, head, notes]);
      const cached = this.notedCache.get(key);
      if (cached?.revision === revision) return cached.keys;
      const keys = await this.notedAt(s, p, head);
      const after = await Promise.all([this.ref(s, 'HEAD'), this.ref(s, notesRef)]);
      if (head !== after[0] || notes !== after[1]) continue;
      this.notedCache.delete(key);
      this.notedCache.set(key, { revision, keys });
      if (this.notedCache.size > 200) this.notedCache.delete(this.notedCache.keys().next().value!);
      return keys;
    }
  }
  private async notedAt(s: Repo, p: string, head: string): Promise<Set<string>> {
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
        head || 'HEAD',
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
  private async attest(s: Repo, oid: string): Promise<string | undefined> {
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
      .filter(
        (p) =>
          p.endsWith('.md') &&
          !p.includes('\n') &&
          classify(s.space, s.prefix + p) === 'Knowledge_Base',
      );
    const identity = (await this.git(s, ['log', '-1', '--format=%cn <%ce>', oid])).trim(),
      key = humanId(identity),
      files: NoteFile[] = [];
    for (const p of changed) {
      const text = await this.blob(s, `${oid}:${p}`);
      if (text === undefined) continue;
      const view = await this.authorship.view({ scopeId: s.scopeId, path: s.prefix + p }, text);
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
          '既存の作者情報ノート（refs/notes/ai）を読めませんでした。',
          'Could not read the existing authorship note (refs/notes/ai).',
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
        '作者情報ノート（refs/notes/ai）を書き込めませんでした。',
        'Could not write the authorship note (refs/notes/ai).',
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
        'クローンは完了しましたが、作者情報ノート（refs/notes/ai）を受信できませんでした。',
        'Cloning finished, but the authorship note (refs/notes/ai) could not be received.',
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
  private async gitDirectory(s: Repo) {
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
  private async remote(s: Repo, branch?: string): Promise<{ value?: GitRemote; identity: string }> {
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
  async status(id: GitTarget): Promise<GitStatus> {
    const root = this.files.get(gitScope(id)).root;
    const key = JSON.stringify([root, gitRepository(id)]);
    const pending = this.statuses.get(key);
    if (pending) {
      // Each pass coalesces its arrivals into one queued follow-up. An edit
      // arriving during a follow-up still needs a subsequent fresh snapshot.
      if (pending.started) pending.followup = true;
      return pending.result;
    }
    const state = { result: undefined! as Promise<GitStatus>, started: false, followup: false };
    const next = (async () => {
      await Promise.resolve();
      for (;;) {
        state.followup = false;
        const revision = this.revisions.get(root);
        if (this.queues.has(root)) this.mutationRefreshes.set(key, { root, target: id });
        state.started = true;
        const repeat = () => {
          const mutating = this.queues.has(root);
          // Keep reads responsive during network writes. Their completion queues
          // one refresh after the last mutation; mutation results use snapshot directly.
          if (mutating) this.mutationRefreshes.set(key, { root, target: id });
          return state.followup || (!mutating && revision !== this.revisions.get(root));
        };
        try {
          const result = await this.readStatus(id);
          if (!repeat()) return result;
        } catch (error) {
          if (!repeat()) throw error;
        }
      }
    })().finally(() => this.statuses.delete(key));
    state.result = next;
    this.statuses.set(key, state);
    return next;
  }
  private async readStatus(id: GitTarget): Promise<GitStatus> {
    let s: Repo;
    try {
      s = await this.repo(id);
    } catch (error) {
      return {
        available: false,
        initializable: typeof id === 'string' && (await this.initializable(id, error)),
        detail:
          error instanceof GitError
            ? t('Git リポジトリを確認できません。', 'Could not find a Git repository.')
            : (error as Error).message,
        changes: [],
        operation: 'none',
        version: '',
      };
    }
    // Do not run the generic onboarding inspection here: its unscoped status would scan contents.
    return this.snapshot(s);
  }
  /** An ordinary folder: Git finds no repository at or above it, and no `.git` entry is there. */
  private async initializable(id: string, error: unknown) {
    if (!(error instanceof GitError) || !/not a git repository/i.test(error.diagnostic))
      return false;
    try {
      await fs.lstat(path.join(this.files.get(id).root, '.git'));
      return false;
    } catch (missing) {
      return (missing as NodeJS.ErrnoException).code === 'ENOENT';
    }
  }
  private async snapshot(s: Repo): Promise<GitStatus> {
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
        // A submodule's own edits are its repository's; here only the commit it is on shows.
        '--ignore-submodules=dirty',
        '--',
        '.',
        ...this.exclusions(s),
      ]),
      this.git(s, ['diff', '--cached', '--name-status', '-z', ...diffOptions]),
      this.remote(s, branch || undefined),
    ]);
    const submodules = await this.submodulePaths(s);
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
      throw Error(t('変更が 4,000 件を超えています。', 'There are more than 4,000 changes.'));
    for (const change of changes) {
      try {
        await this.safePath(s, change.path, submodules);
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
      fetchedAt: this.fetched.get(s.root),
    };
  }
  private async checked(s: Repo, version: string) {
    const status = await this.snapshot(s);
    if (status.version !== version) throw stale();
    return status;
  }
  private async working(s: Repo, p: string): Promise<Buffer | undefined> {
    const submodules = await this.submodulePaths(s);
    await this.safePath(s, p, submodules);
    if (submodules.has(p)) {
      // A submodule is on a commit, which is what the hibachi records of it.
      const root = path.join(s.root, p);
      if (!(await this.initialized(root))) return;
      return Buffer.from(await this.optional({ root }, ['rev-parse', '--verify', 'HEAD']));
    }
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
  async diff(id: GitTarget, p: string, staged: boolean): Promise<GitDiff> {
    const s = await this.repo(id),
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
        // A submodule's change reads as the commits it moved over.
        '--submodule=log',
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
  async stage(id: GitTarget, p: string, stage: boolean, version: string) {
    return this.mutate(id, async (s) => {
      const state = await this.snapshot(s),
        change = state.changes.find((c) => c.path === p);
      if (!change || change.conflict || state.operation === 'other')
        throw Error(
          t(
            '競合が未解決か、他の Git 操作が進行中です。',
            'There is an unresolved conflict, or another Git operation is in progress.',
          ),
        );
      if ((await this.diff(id, p, !stage)).version !== version) throw stale();
      this.validateName(p);
      if (stage) {
        if (change.blocked) throw Error(change.blocked);
        await this.safePath(s, p, await this.submodulePaths(s));
        await this.git(s, ['add', '-A', '--', literal(p)]);
      } else if (state.head)
        await this.git(s, ['restore', '--staged', '--source=HEAD', '--', literal(p)]);
      else await this.git(s, ['rm', '--cached', '--force', '--ignore-unmatch', '--', literal(p)]);
      return this.snapshot(s);
    });
  }
  async stageMany(id: GitTarget, paths: string[], stage: boolean, version: string) {
    return this.mutate(id, async (s) => {
      const state = await this.checked(s, version);
      if (!paths.length || paths.length > 4000 || state.operation === 'other') throw stale();
      const selected = [...new Set(paths)];
      const submodules = await this.submodulePaths(s);
      for (const p of selected) {
        this.validateName(p);
        const change = state.changes.find((c) => c.path === p);
        if (!change || change.conflict) throw stale();
        if (stage) {
          if (change.blocked) throw Error(change.blocked);
          await this.safePath(s, p, submodules);
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
  async commit(id: GitTarget, message: string, version: string) {
    return this.mutate(id, async (s) => {
      const state = await this.checked(s, version);
      if (!message.trim() || message.length > 10000 || message.includes('\0'))
        throw Error(t('commit メッセージを入力してください。', 'Enter a commit message.'));
      if (!state.branch || state.operation === 'other' || state.changes.some((c) => c.conflict))
        throw Error(
          t(
            'ブランチがないか、未解決の競合があります。',
            'There is no branch, or there is an unresolved conflict.',
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
  async history(id: GitTarget, offset = 0): Promise<GitHistory> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
      throw Error(t('履歴の範囲が不正です。', 'The history range is invalid.'));
    const s = await this.repo(id);
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
  async commitDiff(id: GitTarget, oid: string) {
    if (!oidPattern.test(oid))
      throw Error(t('履歴の ID が不正です。', 'The history ID is invalid.'));
    const s = await this.repo(id);
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
          'ブランチ・リモート・最初の commit のいずれかがありません。',
          'Missing a branch, remote, or first commit.',
        ),
      );
    return state.remote;
  }
  /** The submodule paths whose commit differs between two commits of a hibachi. */
  private async movedSubmodules(s: Repo, from: string, to: string) {
    const raw = (
      await this.git(s, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', from, to, '--'])
    ).split('\0');
    const moved = new Map<string, string>();
    for (let i = 0; i + 1 < raw.length; i += 2) {
      // `:old-mode new-mode old-oid new-oid status`
      const [, mode, , oid] = raw[i].split(' ');
      if (mode === '160000') moved.set(raw[i + 1], oid);
    }
    return moved;
  }
  private async checkIncoming(s: Repo, head: string, target: string) {
    const base = (await this.git(s, ['merge-base', head, target])).trim();
    const names = (
      await this.git(s, ['diff', '--name-only', '-z', '--no-renames', base, target, '--'])
    )
      .split('\0')
      .filter(Boolean);
    // A submodule the incoming side records is named as a whole, like one already here.
    const gitlinks = new Set([
      ...(await this.submodulePaths(s)),
      ...(await this.movedSubmodules(s, base, target)).keys(),
    ]);
    for (const p of names) {
      await this.safePath(s, p, gitlinks);
      if (!s.prefix && p === '.irori/scope.json')
        throw Error(
          t(
            '受信内容にスペース定義の変更があります。',
            'The incoming content changes the space definition.',
          ),
        );
    }
  }
  /**
   * After a pull moved the commits the hibachi records for its submodules, moves
   * each submodule along when that is a fast-forward of its branch with nothing
   * uncommitted. Returns what it left for the person to do.
   */
  private async follow(s: Repo, from: string, to: string): Promise<string | undefined> {
    const left: string[] = [];
    for (const [p, oid] of await this.movedSubmodules(s, from, to)) {
      const root = path.join(s.root, p);
      if (!oidPattern.test(oid) || !(await this.initialized(root))) continue;
      const sub = { root };
      try {
        const [head, branch, dirty] = await Promise.all([
          this.optional(sub, ['rev-parse', '--verify', 'HEAD']),
          this.optional(sub, ['symbolic-ref', '--short', 'HEAD']),
          this.optional(sub, ['status', '--porcelain', '--ignore-submodules=all']),
        ]);
        if (head === oid) continue;
        if (!branch || dirty) throw Error('unsafe');
        if (!(await this.ref(sub, `${oid}^{commit}`))) {
          const remote =
            (await this.optional(sub, ['config', '--get', `branch.${branch}.remote`])) || 'origin';
          if (!/^[\w.-]+$/.test(remote)) throw Error('remote');
          await this.git(sub, ['fetch', '--no-tags', '--no-recurse-submodules', remote], {
            network: true,
          });
        }
        await this.git(sub, ['merge-base', '--is-ancestor', head, oid]);
        await this.git(sub, ['merge', '--ff-only', '--no-autostash', oid]);
      } catch {
        left.push(p);
      }
    }
    if (left.length)
      return t(
        `submodule ${left.join('、')} は記録された commit に移していません。各 submodule で Pull してください。`,
        `The submodule${left.length === 1 ? '' : 's'} ${left.join(', ')} ${left.length === 1 ? 'was' : 'were'} not moved to the recorded commit. Pull in each submodule.`,
      );
  }
  /** Pushes the checked-out commit to its branch on `remote`, and the notes after it. */
  private async push(s: Repo, state: GitStatus, remote: GitRemote): Promise<string | undefined> {
    const urls = (await this.git(s, ['remote', 'get-url', '--push', '--all', remote.name]))
      .trimEnd()
      .split('\n');
    if (urls.length !== 1)
      throw Error(t('送信先が複数あります。', 'There are multiple push destinations.'));
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
        return t(
          '作者情報ノート（refs/notes/ai）は送信されませんでした。',
          'The authorship note (refs/notes/ai) was not pushed.',
        );
      }
  }
  async sync(id: GitTarget, action: GitSyncAction, version: string) {
    return this.mutate(id, async (s) => {
      const state = await this.checked(s, version),
        remote = this.requireRemote(state);
      if (state.operation !== 'none' && action !== 'fetch')
        throw Error(t('別の Git 操作が進行中です。', 'Another Git operation is in progress.'));
      let notice: string | undefined;
      if (action === 'push') notice = await this.push(s, state, remote);
      else {
        if (action !== 'fetch' && state.changes.length)
          throw Error(
            t(
              'ローカルに commit していない変更があります。',
              'There are uncommitted local changes.',
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
        this.fetched.set(s.root, new Date().toISOString());
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
                    '履歴が分岐しているか、受信内容を適用できません。',
                    'The history has diverged, or the incoming content cannot be applied.',
                  ),
                );
              throw error;
            }
          }
          if (action === 'pull' && !s.prefix) {
            const left = await this.follow(s, state.head!, target);
            notice = [notice, left].filter(Boolean).join(' ') || undefined;
          }
        }
      }
      const status = await this.snapshot(s);
      return notice ? { ...status, notice } : status;
    });
  }
  async conflict(id: GitTarget, p: string): Promise<GitConflict> {
    const s = await this.repo(id),
      state = await this.snapshot(s);
    await this.safePath(s, p, await this.submodulePaths(s));
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
            'rebase・cherry-pick 等はここでは編集できません。',
            'Cannot be edited here during a rebase, cherry-pick, or similar operation.',
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
          'リンク・submodule の競合はここでは編集できません。',
          'Link and submodule conflicts cannot be edited here.',
        );
        blobs.push(undefined);
        continue;
      }
      if (Number(await this.git(s, ['cat-file', '-s', entry[1]])) > 2 * 1024 * 1024) {
        editable = false;
        detail = t(
          '2 MiB を超える競合はここでは編集できません。',
          'Conflicts over 2 MiB cannot be edited here.',
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
          'バイナリ・UTF-8 以外の競合はここでは編集できません。',
          'Binary and non-UTF-8 conflicts cannot be edited here.',
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
        '作業ファイルをテキストとして編集できません。',
        'The working file cannot be edited as text.',
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
  async resolve(id: GitTarget, p: string, text: string | null, version: string) {
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
            '統合内容に競合マーカーがあるか、2 MiB を超えています。',
            'The merged content has conflict markers, or is larger than 2 MiB.',
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
        JSON.stringify({ scopeId: s.scopeId, repository: s.prefix.slice(0, -1), ...conflict }),
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
          await replaceFile(temp, filename);
        } finally {
          await fs.rm(temp, { force: true });
        }
      }
      await this.git(s, ['add', '-A', '--', literal(p)]);
      return this.snapshot(s);
    });
  }
  /** The submodules the hibachi holds, with whether each one's files are here. */
  async submodules(id: string): Promise<GitSubmodules> {
    let s: Repo;
    try {
      s = await this.repo(id);
    } catch {
      return { submodules: [] };
    }
    return { submodules: await this.listSubmodules(s) };
  }
  private async listSubmodules(s: Repo): Promise<GitSubmodule[]> {
    const list: GitSubmodule[] = [];
    for (const m of await this.recorded(s)) {
      const root = path.join(s.root, m.path);
      const item: GitSubmodule = {
        path: m.path,
        name: m.name,
        repository: githubRepository(m.url),
        initialized: await this.initialized(root),
      };
      if (item.initialized) {
        const sub: Repo = { ...s, root, prefix: m.path + '/' };
        item.branch = (await this.optional(sub, ['symbolic-ref', '--short', 'HEAD'])) || undefined;
        item.changed = !!(await this.optional(sub, [
          'status',
          '--porcelain=v1',
          '--untracked-files=normal',
          '--ignore-submodules=dirty',
          '--',
          '.',
          ...this.exclusions(sub),
        ]));
      }
      list.push(item);
    }
    return list;
  }
  /** Git configuration that lets a submodule come only over the allowed transports. */
  private protocols() {
    return [
      '-c',
      'protocol.allow=never',
      ...this.submoduleRemotes.protocols.flatMap((p) => ['-c', `protocol.${p}.allow=always`]),
    ];
  }
  /**
   * Clones a repository into a new folder of the hibachi as a submodule. Git
   * stages the submodule and `.gitmodules`; committing them is the person's.
   */
  async addSubmodule(id: string, input: AddSubmodule): Promise<GitSubmodules> {
    if (!this.submoduleRemotes.accepts(input.url)) throw cloneURLRequired();
    return this.mutate(id, async (s) => {
      const p = input.path.replace(/\/+$/, '');
      await this.safePath(s, p);
      if (p.split('/')[0].startsWith('.') || p.split('/')[0] === 'schema')
        throw Error(
          t(
            'submodule は Knowledge のフォルダに置いてください。',
            'Put a submodule in a Knowledge folder.',
          ),
        );
      try {
        await fs.lstat(path.join(s.root, p));
        throw Error(t('同じ名前のフォルダがあります。', 'A folder with this name already exists.'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await this.git(
        s,
        [...this.protocols(), '--literal-pathspecs', 'submodule', 'add', '--', input.url, p],
        { network: true },
      );
      const notes = await this.fetchNotes({ root: path.join(s.root, p) }, 'origin');
      return { submodules: await this.listSubmodules(s), notice: notes };
    });
  }
  /** Fetches the files of the submodule at `only`, or of every submodule not yet here. */
  async initSubmodules(id: string, only?: string): Promise<GitSubmodules> {
    return this.mutate(id, async (s) => {
      if (only && !(await this.submodulePaths(s)).has(only))
        throw Error(
          t(
            'この hibachi の submodule ではありません。',
            'This is not a submodule of the hibachi.',
          ),
        );
      const notice = await this.fetchSubmodules(s, only);
      if (only && notice) throw Error(notice);
      return { submodules: await this.listSubmodules(s), notice };
    });
  }
  /** A clone before registration, seen with the contents its declaration names. */
  private async unregistered(root: string): Promise<Repo> {
    let contents = ['contents'];
    try {
      const declared = JSON.parse(
        await fs.readFile(path.join(root, '.irori', 'scope.json'), 'utf8'),
      ) as { contents?: unknown };
      if (Array.isArray(declared.contents) && declared.contents.every((c) => typeof c === 'string'))
        contents = declared.contents;
    } catch {
      /* no declaration yet: registration will write the default */
    }
    return main({ schemaVersion: 1, scopeId: '', name: '', contents, root });
  }
  /**
   * Fetches each submodule whose files are not here yet, and returns what could
   * not be fetched. A submodule comes only from an allowed remote, without its
   * own submodules, and is put on its branch when the commit the hibachi records
   * is on it, so it can be committed to and pushed.
   */
  private async fetchSubmodules(s: Repo, only?: string): Promise<string | undefined> {
    const failed: string[] = [];
    const recorded = await this.recorded(s);
    const links = new Set(recorded.map((m) => m.path));
    for (const m of recorded) {
      if (only && m.path !== only) continue;
      const root = path.join(s.root, m.path);
      if (await this.initialized(root)) continue;
      try {
        await this.safePath(s, m.path, links);
        const entries = await fs.readdir(root).catch(() => [] as string[]);
        if (entries.length) throw Error('occupied');
        await this.git(s, ['--literal-pathspecs', 'submodule', 'init', '--', m.path]);
        const url = await this.config(s, `submodule.${m.name}.url`);
        if (!this.submoduleRemotes.accepts(url)) {
          await this.optional(s, ['config', '--remove-section', `submodule.${m.name}`]);
          throw Error('remote');
        }
        await this.git(
          s,
          [
            ...this.protocols(),
            '--literal-pathspecs',
            'submodule',
            'update',
            '--checkout',
            '--no-recommend-shallow',
            '--',
            m.path,
          ],
          { network: true },
        );
        if (!(await this.initialized(root))) throw Error('missing');
        await this.attach({ root }, m.branch);
        await this.fetchNotes({ root }, 'origin');
      } catch {
        failed.push(m.path);
      }
    }
    if (failed.length)
      return t(
        `submodule ${failed.join('、')} を取得できませんでした。`,
        `Could not fetch the submodule${failed.length === 1 ? '' : 's'} ${failed.join(', ')}.`,
      );
  }
  /**
   * Puts a newly fetched submodule on a branch at the commit the hibachi records,
   * when that commit is on the branch `.gitmodules` names or the remote's default.
   * Otherwise it stays on the commit itself, where it can be read but not committed to.
   */
  private async attach(sub: Pick<Space, 'root'>, declared: string) {
    const head = await this.ref(sub, 'HEAD');
    const branch =
      declared && declared !== '.'
        ? declared
        : (
            await this.optional(sub, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
          ).replace(/^origin\//, '');
    if (!head || !branch || !(await this.optional(sub, ['check-ref-format', '--branch', branch])))
      return;
    const upstream = `refs/remotes/origin/${branch}`;
    if (!(await this.ref(sub, upstream))) return;
    try {
      await this.git(sub, ['merge-base', '--is-ancestor', head, upstream]);
    } catch {
      return;
    }
    await this.git(sub, ['checkout', '--quiet', '-B', branch, head]);
    await this.git(sub, ['branch', '--quiet', `--set-upstream-to=origin/${branch}`, branch]);
  }
  async repositoryURL(id: GitTarget) {
    const s = await this.repo(id),
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
  /**
   * A new, empty folder for a clone or a new hibachi: outside every registered
   * space and cloud material, never an existing folder.
   */
  private async newFolder(parentInput: string, name: string, purpose: 'clone' | 'create') {
    if (
      !name.trim() ||
      name.length > 120 ||
      /[\\/:*?"<>|\x00-\x1f]/.test(name) ||
      name.startsWith('.') ||
      /[. ]$/.test(name)
    )
      throw Error(t('新しいフォルダ名を入力してください。', 'Enter a name for the new folder.'));
    const parent = await fs.realpath(parentInput);
    if (!(await fs.stat(parent)).isDirectory())
      throw Error(
        t('保存先の親フォルダを選択してください。', 'Select the parent folder to save into.'),
      );
    for (const s of this.files.list()) {
      if (within(s.root, parent))
        throw Error(
          t(
            '保存先が登録済みスペースの内側です。',
            'The destination is inside a registered space.',
          ),
        );
      for (const contents of s.contents) {
        const root = path.join(s.root, contents);
        const children = await fs.readdir(root).catch(() => [] as string[]);
        for (const candidate of [root, ...children.map((c) => path.join(root, c))]) {
          const actual = await fs.realpath(candidate).catch(() => undefined);
          if (actual && within(actual, parent))
            throw Error(
              purpose === 'clone'
                ? t(
                    'クラウド資料の中にはリポジトリを取得できません。',
                    'A repository cannot be cloned inside cloud materials.',
                  )
                : t(
                    'クラウド資料の中には hibachi を作成できません。',
                    'A hibachi cannot be created inside cloud materials.',
                  ),
            );
        }
      }
    }
    const destination = path.join(parent, name);
    try {
      await fs.mkdir(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw Error(t('同じ名前のフォルダがあります。', 'A folder with this name already exists.'));
      throw error;
    }
    return { parent, destination };
  }
  /**
   * Clones into a new folder. `duringRuns`: the irori agent asked from its run,
   * and a new folder is out of every run's reach, so runs do not stop it.
   */
  async clone(input: CloneRepository, duringRuns = false): Promise<CloneResult> {
    if ((!duringRuns && !this.canMutate()) || this.busy)
      throw Error(t('別の処理が実行中です。', 'Another operation is running.'));
    if (!githubCloneURL(input.url)) throw cloneURLRequired();
    this.pending++;
    try {
      const { parent, destination } = await this.newFolder(input.parent, input.name, 'clone');
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
              '取得途中のフォルダを保持しています。',
              'The partially cloned folder is kept.',
            )}`,
            ...detail,
          ].join('\n\n'),
        );
      }
      const notes = await this.fetchNotes({ root: destination }, 'origin');
      const fetched = await this.fetchSubmodules(await this.unregistered(destination));
      const notice = [notes, fetched].filter(Boolean).join(' ') || undefined;
      return { path: destination, notice };
    } finally {
      this.pending--;
    }
  }
  /**
   * The folder of a new hibachi: created empty and made a Git repository on
   * `main`, ready for registration. Nothing is committed yet.
   */
  async create(input: Pick<CreateSpace, 'parent' | 'folder'>, duringRuns = false): Promise<string> {
    if ((!duringRuns && !this.canMutate()) || this.busy)
      throw Error(t('別の処理が実行中です。', 'Another operation is running.'));
    this.pending++;
    try {
      const { destination } = await this.newFolder(input.parent, input.folder, 'create');
      try {
        await this.initialize({ root: destination });
      } catch (error) {
        await this.abandon(destination);
        throw error;
      }
      return destination;
    } finally {
      this.pending--;
    }
  }
  /**
   * Removes a new hibachi's folder that could not be registered, but only while
   * it holds nothing beyond what irori itself wrote there.
   */
  async abandon(root: string) {
    const written = new Set(['.git', '.irori', '.gitignore']);
    const entries = await fs.readdir(root).catch(() => undefined);
    if (!entries?.every((entry) => written.has(entry))) return;
    for (const entry of entries)
      await fs.rm(path.join(root, entry), { recursive: true, force: true });
    await fs.rmdir(root).catch(() => {});
  }
  private async initialize(s: Pick<Space, 'root'>) {
    await this.git(s, ['init', '--quiet']);
    // Every Git version, whatever its `init.defaultBranch`, starts on `main`.
    await this.git(s, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  }
  /**
   * The first commit of a hibachi made here: only the files registration wrote.
   * Returns why it was not made (no author identity, a hook, signing) instead of failing.
   */
  async firstCommit(id: string, duringRuns = false): Promise<string | undefined> {
    try {
      await this.mutate(
        id,
        async (s) => {
          const paths = ['.irori/scope.json', '.gitignore'];
          for (const p of paths) this.boundary(s, p);
          await this.git(s, ['add', '--', ...paths.map(literal)]);
          await this.git(s, [
            'commit',
            '--quiet',
            '-m',
            t(`hibachi「${s.name}」を作成`, `Create the hibachi ${s.name}`),
            '--',
            ...paths.map(literal),
          ]);
        },
        undefined,
        duringRuns,
      );
    } catch (error) {
      const [advice, ...detail] = (error as Error).message.split('\n\n');
      return [
        `${t(
          'hibachi は作成しましたが、最初の commit はできませんでした。',
          'The hibachi was created, but its first commit could not be made.',
        )}\n${advice}`,
        ...detail,
      ].join('\n\n');
    }
  }
  /** Makes a registered hibachi that is an ordinary folder a Git repository on `main`. */
  async init(id: string): Promise<GitStatus> {
    await this.mutate(
      id,
      async (s) => s,
      async () => {
        const s = main(this.files.get(id));
        const status = await this.readStatus(id);
        if (!status.initializable)
          throw Error(
            t(
              'この hibachi はすでに Git リポジトリか、Git で扱えない場所にあります。',
              'This hibachi is already a Git repository, or is somewhere Git cannot use.',
            ),
          );
        await this.initialize(s);
        return s;
      },
    );
    return this.status(id);
  }
  /** The GitHub account the GitHub CLI is signed in to, for choosing where to publish. */
  githubAccount() {
    return this.github.account();
  }
  /**
   * Creates a repository on GitHub for a hibachi that has none, sets it as
   * `origin` and pushes the checked-out branch to it, with the authorship notes.
   */
  async publish(id: string, input: PublishRepository, version: string): Promise<GitStatus> {
    return this.mutate(id, async (s) => {
      const state = await this.checked(s, version);
      if (!state.head || !state.branch)
        throw Error(t('commit がありません。', 'There is no commit yet.'));
      if (state.operation !== 'none')
        throw Error(t('別の Git 操作が進行中です。', 'Another Git operation is in progress.'));
      if (await this.optional(s, ['remote']))
        throw Error(
          t(
            'この hibachi にはすでにリモートが設定されています。',
            'This hibachi already has a remote.',
          ),
        );
      await this.git(s, ['check-ref-format', `refs/heads/${state.branch}`]);
      const repository = await this.github.create(input);
      const url =
        (await this.github.protocol()) === 'ssh'
          ? `git@github.com:${repository}.git`
          : `https://github.com/${repository}.git`;
      let notice: string | undefined;
      try {
        await this.git(s, ['remote', 'add', 'origin', url]);
        await this.git(s, ['config', `branch.${state.branch}.remote`, 'origin']);
        await this.git(s, ['config', `branch.${state.branch}.merge`, `refs/heads/${state.branch}`]);
        const next = await this.snapshot(s);
        notice = await this.push(s, next, this.requireRemote(next));
      } catch (error) {
        const [advice, ...detail] = (error as Error).message.split('\n\n');
        throw Error(
          [
            `${t(
              `GitHub に ${repository} を作成しましたが、送信は完了していません。`,
              `${repository} was created on GitHub, but sending did not finish.`,
            )}\n${advice}`,
            ...detail,
          ].join('\n\n'),
        );
      }
      // The push above set the branch on GitHub to this commit, as a named push would record.
      await this.git(s, ['update-ref', `refs/remotes/origin/${state.branch}`, state.head]);
      const status = await this.snapshot(s);
      return notice ? { ...status, notice } : status;
    });
  }
  async close() {
    this.closing = true;
    await Promise.allSettled(this.queues.values());
    await this.process.close();
    await this.github.close();
  }
}
