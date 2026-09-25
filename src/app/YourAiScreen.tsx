import { useEffect, useRef, useState } from 'react';
import type { Space } from '../domain/types';
import { agentNames } from '../domain/types';
import type { BrainAgent, YourAi } from '../domain/you';
import { t } from '../domain/i18n';
import { BrainTile } from './BrainTile';
import { Icon } from './Icon';
import { useResource } from './useResource';
import './you.css';

const host = window.irori;
/** Where your AI keeps one Claude Code sub-agent definition per brain. */
const agentsFolder = '.claude/agents';
const definitionOf = (agent: string) => `${agentsFolder}/${agent}.md`;
/** Folders open when the screen first shows, so the definitions are in view. */
const initiallyOpen = ['.claude', agentsFolder];

/** A host error without the `Error: ` prefixes it gathers on its way to the renderer. */
const message = (error: string) => error.replace(/^(?:Error: )+/, '');

/** A path whose end stays in view: a long start gives way to an ellipsis. */
function PathText({ path, className }: { path: string; className: string }) {
  return (
    <span className={`${className} you-tail`} title={path}>
      <bdi dir="ltr">{path}</bdi>
    </span>
  );
}

/** A definition's front matter (name, description, tools), set apart from its prompt. */
function splitFrontMatter(text: string): [string, string] {
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return ['', text];
  for (let index = 1; index < lines.length; index++)
    if (lines[index].trim() === '---') {
      const head = lines.slice(0, index + 1).join('\n');
      return [head, text.slice(head.length)];
    }
  return ['', text];
}

/** One folder of your AI's folder, read when it is opened. */
function Folder({
  directory,
  depth,
  reads,
  open,
  file,
  owners,
  onToggle,
  onShow,
}: {
  directory: string;
  depth: number;
  reads: number;
  open: string[];
  file: string;
  /** The brain each sub-agent name belongs to. */
  owners: Map<string, Space>;
  onToggle: (path: string) => void;
  onShow: (path: string) => void;
}) {
  const listing = useResource(() => host.yourAiEntries(directory), [directory], {
    refresh: reads,
  });
  const indent = { paddingLeft: 10 + depth * 14 };
  return (
    <div
      className="you-tree"
      role={depth ? 'group' : undefined}
      aria-label={depth ? directory : undefined}
    >
      {listing.loading && (
        <small className="you-tree-note" style={indent}>
          {t('読み込み中…', 'Loading…')}
        </small>
      )}
      {listing.error && (
        <small className="you-tree-note error" role="alert" style={indent}>
          {message(listing.error)}
        </small>
      )}
      {listing.data && !listing.data.length && !listing.error && (
        <small className="you-tree-note" style={indent}>
          {t('項目がありません', 'No items')}
        </small>
      )}
      {listing.data?.map((entry) => {
        const expanded = entry.directory && open.includes(entry.path);
        const current = !entry.directory && entry.path === file;
        const owner =
          !entry.directory && directory === agentsFolder && entry.name.endsWith('.md')
            ? owners.get(entry.name.slice(0, -'.md'.length))
            : undefined;
        return (
          <div key={entry.path} className="you-tree-item">
            <button
              className={`you-tree-row ${current ? 'selected' : ''}`}
              style={indent}
              aria-expanded={entry.directory ? expanded : undefined}
              aria-current={current ? 'page' : undefined}
              title={
                owner
                  ? t(`${entry.path} · ${owner.name} の AI`, `${entry.path} · ${owner.name}'s AI`)
                  : entry.path
              }
              onClick={() => (entry.directory ? onToggle(entry.path) : onShow(entry.path))}
            >
              {entry.directory ? (
                <Icon
                  name={expanded ? 'chevronDown' : 'chevron'}
                  size={12}
                  className="you-tree-chevron"
                />
              ) : (
                <span className="you-tree-chevron" />
              )}
              {owner ? (
                <BrainTile space={owner} size={16} radius={5} />
              ) : (
                <Icon
                  name={entry.directory ? (expanded ? 'folderOpen' : 'folder') : 'file'}
                  size={15}
                  className="you-tree-icon"
                />
              )}
              <span className="you-tree-name">{entry.name}</span>
            </button>
            {expanded && (
              <Folder
                directory={entry.path}
                depth={depth + 1}
                reads={reads}
                open={open}
                file={file}
                owners={owners}
                onToggle={onToggle}
                onShow={onShow}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The chosen file, read-only on the paper stage. */
function FileView({ path, reads }: { path: string; reads: number }) {
  const read = useResource(() => host.yourAiRead(path), [path], { refresh: reads });
  return (
    <section className="you-stage on-stage" aria-label={t('ファイルの内容', 'File contents')}>
      <header className="you-stage-bar">
        <span className="you-stage-owner">
          <span className="you-orb small" aria-hidden="true">
            <Icon name="sparkles" size={11} strokeWidth={2.2} />
          </span>
          {t('あなたの AI', 'Your AI')}
        </span>
        <Icon name="chevron" size={12} className="you-stage-separator" />
        <PathText path={path} className="you-stage-path" />
        <span className="you-stage-space" />
        <span
          className="you-stage-note"
          title={t(
            'irori はこのフォルダに書き込みません。変更はあなたの AI に頼んでください。',
            'irori does not write to this folder. Ask your AI to change it.',
          )}
        >
          <Icon name="lock" size={12} />
          {t('読み取り専用', 'Read-only')}
        </span>
      </header>
      {read.error ? (
        <p className="you-stage-state error" role="alert">
          {message(read.error)}
        </p>
      ) : read.data ? (
        read.data.text ? (
          <pre className="you-file" tabIndex={0}>
            {read.data.text}
          </pre>
        ) : (
          <p className="you-stage-state">{t('空のファイルです。', 'This file is empty.')}</p>
        )
      ) : (
        <p className="you-stage-state">{t('読み込み中…', 'Loading…')}</p>
      )}
    </section>
  );
}

/** One brain's sub-agent definition in a small card, or a word that it is not written yet. */
function Definition({ brain, reads }: { brain: BrainAgent; reads: number }) {
  const path = definitionOf(brain.agent);
  const read = useResource(() => host.yourAiRead(path), [path], {
    enabled: brain.defined,
    refresh: reads,
  });
  const [head, body] = splitFrontMatter(read.data?.text ?? '');
  return (
    <div className="you-definition">
      <header>
        <Icon name="file" size={13} />
        <PathText path={path} className="you-definition-path" />
        <small>{agentNames.claude}</small>
      </header>
      {!brain.defined ? (
        <p className="you-definition-note">
          {t(
            `${brain.name} の AI はまだ定義されていません。下のボタンで、あなたの AI に書いてもらえます。`,
            `${brain.name}'s AI is not defined yet. Use the button below to have your AI write it.`,
          )}
        </p>
      ) : read.error ? (
        <p className="you-definition-note error" role="alert">
          {message(read.error)}
        </p>
      ) : read.data ? (
        <pre tabIndex={0}>
          {head && <span className="you-front">{head}</span>}
          {body}
        </pre>
      ) : (
        <p className="you-definition-note">{t('読み込み中…', 'Loading…')}</p>
      )}
    </div>
  );
}

/**
 * Your AI: its folder, read-only, and the sub-agent it hands each brain's work
 * to. irori never writes the definitions; it asks your AI to update them.
 */
export function YourAiScreen({
  you,
  spaces,
  running,
  onUpdateDefinitions,
  onBack,
  onError,
}: {
  you: YourAi;
  spaces: Space[];
  running: boolean;
  onUpdateDefinitions: () => Promise<void>;
  onBack: () => void;
  onError: (error: unknown) => void;
}) {
  // Every read of the folder and the brains follows this count.
  const [reads, setReads] = useState(0);
  const reread = () => setReads((value) => value + 1);
  const wasRunning = useRef(running);
  useEffect(() => {
    // Your AI may have just written definitions.
    if (wasRunning.current && !running) reread();
    wasRunning.current = running;
  }, [running]);
  const [file, setFile] = useState('AGENTS.md');
  const [open, setOpen] = useState(initiallyOpen);
  const [picked, setPicked] = useState<string>();
  const [sending, setSending] = useState(false);
  const ids = spaces.map((space) => space.scopeId);
  const brains = useResource(() => host.yourAiBrains(ids), [ids.join()], {
    enabled: ids.length > 0,
    refresh: reads,
  });
  const agents = new Map((brains.data ?? []).map((brain) => [brain.scopeId, brain]));
  const owners = new Map<string, Space>();
  for (const space of spaces) {
    const brain = agents.get(space.scopeId);
    if (brain) owners.set(brain.agent, space);
  }
  const chosen = spaces.find((space) => space.scopeId === picked) ?? spaces[0];
  const chosenAgent = chosen && agents.get(chosen.scopeId);
  const toggle = (path: string) =>
    setOpen((value) =>
      value.includes(path) ? value.filter((item) => item !== path) : [...value, path],
    );
  const show = (path: string) => {
    setFile(path);
    // A brain's definition also picks that brain on the right.
    const owner = path.startsWith(`${agentsFolder}/`)
      ? owners.get(path.slice(agentsFolder.length + 1).replace(/\.md$/, ''))
      : undefined;
    if (owner) setPicked(owner.scopeId);
  };
  async function update() {
    setSending(true);
    try {
      await onUpdateDefinitions();
    } catch (error) {
      onError(error);
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="your-ai-screen">
      <section
        className="you-panel you-folder chrome"
        aria-label={t('あなたの AI のフォルダ', 'Your AI folder')}
      >
        <header className="you-head">
          <div className="you-identity">
            <button
              className="icon-button"
              aria-label={t('全体に戻る', 'Back to the Overview')}
              title={t('全体に戻る', 'Back to the Overview')}
              onClick={onBack}
            >
              <Icon name="back" size={16} />
            </button>
            <span className="you-orb" aria-hidden="true">
              <Icon name="sparkles" size={16} strokeWidth={2.1} />
            </span>
            <span className="you-names">
              <h1>{t('あなたの AI', 'Your AI')}</h1>
              <PathText path={you.root} className="you-root" />
            </span>
          </div>
          <div className="you-chips">
            <span
              className="you-chip"
              title={t('あなたの AI は Claude Code で動きます', 'Your AI runs in Claude Code')}
            >
              <Icon name="sparkles" size={13} />
              {agentNames.claude}
            </span>
          </div>
        </header>
        <div className="you-tree-section">
          <div className="you-tree-heading">
            <h2>
              <Icon name="schema" size={15} strokeWidth={1.9} />
              Schema
            </h2>
            <button
              className="you-action"
              aria-label={t('フォルダを読み直す', 'Reload the folder')}
              title={t('フォルダを読み直す', 'Reload the folder')}
              onClick={reread}
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>
          <div className="you-tree-body">
            <Folder
              directory=""
              depth={0}
              reads={reads}
              open={open}
              file={file}
              owners={owners}
              onToggle={toggle}
              onShow={show}
            />
          </div>
        </div>
      </section>
      <FileView path={file} reads={reads} />
      <section className="you-panel you-brains chrome" aria-label={t('Brain の AI', 'Brain AIs')}>
        <header className="you-brains-head">
          <Icon name="users" size={16} />
          <h2>{t('Brain の AI', 'Brain AIs')}</h2>
          <span className="you-count">{spaces.length}</span>
        </header>
        <div className="you-brains-body">
          {!spaces.length ? (
            <p className="you-brains-note">
              {t('このワークスペースに Brain がありません。', 'This workspace has no brain yet.')}
            </p>
          ) : (
            <div className="you-brain-list">
              {spaces.map((space) => {
                const brain = agents.get(space.scopeId);
                return (
                  <button
                    key={space.scopeId}
                    className="you-brain-row"
                    aria-pressed={space.scopeId === chosen?.scopeId}
                    onClick={() => setPicked(space.scopeId)}
                  >
                    <BrainTile space={space} size={26} radius={8} />
                    <span className="you-brain-names">
                      <strong>{t(`${space.name} の AI`, `${space.name}'s AI`)}</strong>
                      <small>{brain?.agent ?? '…'}</small>
                    </span>
                    {brain &&
                      (brain.defined ? (
                        <span className="you-state defined">
                          <Icon name="checkCircle" size={12} />
                          {t('定義済み', 'Defined')}
                        </span>
                      ) : (
                        <span className="you-state">
                          <i />
                          {t('未定義', 'Not defined')}
                        </span>
                      ))}
                  </button>
                );
              })}
            </div>
          )}
          {brains.error && (
            <p className="you-brains-note error" role="alert">
              {message(brains.error)}
            </p>
          )}
          {chosenAgent && <Definition brain={chosenAgent} reads={reads} />}
          <p className="you-later">
            <Icon name="info" size={13} />
            {t(
              'Codex の定義（.codex/agents）は今後対応します。',
              'Codex definitions (.codex/agents) come later.',
            )}
          </p>
        </div>
        <footer className="you-update">
          <button
            className="ember-button"
            disabled={running || sending || !spaces.length}
            onClick={() => void update()}
          >
            <Icon
              name={sending ? 'loader' : 'sparkles'}
              size={15}
              className={sending ? 'you-spin' : ''}
            />
            {t('あなたの AI に定義を更新させる', 'Ask your AI to update the definitions')}
          </button>
          <p className="you-update-state" role="status">
            {running && (
              <>
                <Icon name="loader" size={12} className="you-spin" />
                {t(
                  'あなたの AI が作業中です。終わると、フォルダと定義を読み直します。',
                  'Your AI is working. The folder and the definitions are read again when it finishes.',
                )}
              </>
            )}
          </p>
          <p className="you-update-hint">
            {t('あなたの AI が brain-agents スキルで、Brain ごとに ', 'Your AI writes ')}
            <code>{definitionOf('<agent>')}</code>
            {t(
              ' を書きます。irori が定義を書くことはありません。',
              ' for each brain with its brain-agents skill. irori never writes a definition itself.',
            )}
          </p>
        </footer>
      </section>
    </div>
  );
}
