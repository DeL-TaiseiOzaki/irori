import { useEffect, useRef, useState } from 'react';
import type { AgentId, Space } from '../domain/types';
import { agentNames } from '../domain/types';
import type { YourAi } from '../domain/you';
import { t } from '../domain/i18n';
import { BrainTile } from './BrainTile';
import { SchemaEditor, SchemaList, type SchemaTarget } from './SchemaSettings';
import { Icon } from './Icon';
import { IroriAgentFolderSection } from './IroriAgentFolder';
import { useResource } from './useResource';
import './you.css';

const host = window.irori;
/** A host error without the `Error: ` prefixes it gathers on its way to the renderer. */
const message = (error: string) => error.replace(/^(?:Error: )+/, '');

/** A path whose end stays in view: a long start gives way to an ellipsis. */
function PathText({ path, className }: { path: string; className: string }) {
  return (
    <span className={`${className} you-tail`}>
      <bdi dir="ltr">{path}</bdi>
    </span>
  );
}

/** One folder of your AI's folder, read when it is opened. */
function Folder({
  directory,
  depth,
  reads,
  open,
  file,
  onToggle,
  onShow,
}: {
  directory: string;
  depth: number;
  reads: number;
  open: string[];
  file: string;
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
        return (
          <div key={entry.path} className="you-tree-item">
            <button
              className={`you-tree-row ${current ? 'selected' : ''}`}
              style={indent}
              aria-expanded={entry.directory ? expanded : undefined}
              aria-current={current ? 'page' : undefined}
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
              <Icon
                name={entry.directory ? (expanded ? 'folderOpen' : 'folder') : 'file'}
                size={15}
                className="you-tree-icon"
              />
              <span className="you-tree-name">{entry.name}</span>
            </button>
            {expanded && (
              <Folder
                directory={entry.path}
                depth={depth + 1}
                reads={reads}
                open={open}
                file={file}
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
          {t('irori agent', 'irori agent')}
        </span>
        <Icon name="chevron" size={12} className="you-stage-separator" />
        <PathText path={path} className="you-stage-path" />
        <span className="you-stage-space" />
        <span className="you-stage-note">
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

/**
 * The irori agent (your AI): its Schema settings, the same as a vault's, its
 * folder as files, read-only, and the vault agent it hands each brain's work
 * to with `irori call` (ADR 050).
 */
export function YourAiScreen({
  you,
  workspaceId,
  pointed,
  onFolderChanged,
  agent,
  spaces,
  running,
  revision,
  onBack,
  onAddSkills,
}: {
  you: YourAi;
  /** The workspace on show, whose folder the irori agent works in (ADR 044). */
  workspaceId: string;
  /** A file of the folder a reply named, to show; `n` counts each request. */
  pointed?: { path: string; n: number };
  onFolderChanged: () => void;
  /** The CLI your AI runs on. */
  agent: AgentId;
  spaces: Space[];
  /** While the irori agent runs, its Schema does not change, as a vault's does not. */
  running: boolean;
  /** Counts the host's file changes, the Schema settings' own writes among them. */
  revision: number;
  onBack: () => void;
  /** Writes the standard skills the folder lacks, which `you.missingSkills` names. */
  onAddSkills: () => Promise<void>;
}) {
  // Every read of the folder and the brains follows this count.
  const [local, setReads] = useState(0);
  const reads = local + revision;
  const reread = () => setReads((value) => value + 1);
  // Which standard skills the folder lacks follows the folder, as the files do.
  const status = useResource(() => host.yourAi(), [], { refresh: reads });
  const missingSkills = status.data?.missingSkills ?? you.missingSkills;
  // The Schema settings first, as in a vault; the folder's files are one click away.
  const [schemaFiles, setSchemaFiles] = useState(false);
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<SchemaTarget | undefined>({
    kind: 'instructions',
    key: 'AGENTS.md',
  });
  const wasRunning = useRef(running);
  useEffect(() => {
    // irori or your AI may have just written definitions.
    if (wasRunning.current && !running) reread();
    wasRunning.current = running;
  }, [running]);
  const [file, setFile] = useState('AGENTS.md');
  const [open, setOpen] = useState<string[]>([]);
  const ids = spaces.map((space) => space.scopeId);
  const brains = useResource(() => host.yourAiBrains(ids), [ids.join()], {
    enabled: ids.length > 0,
    refresh: reads,
  });
  const agents = new Map((brains.data ?? []).map((brain) => [brain.scopeId, brain]));
  const toggle = (path: string) =>
    setOpen((value) =>
      value.includes(path) ? value.filter((item) => item !== path) : [...value, path],
    );
  const show = (path: string) => {
    setTarget(undefined);
    setFile(path);
  };
  // A path in a reply opens its file with the folders on its way open.
  useEffect(() => {
    if (!pointed) return;
    const parts = pointed.path.split('/').slice(0, -1);
    const folders = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    setSchemaFiles(true);
    setOpen((value) => [...new Set([...value, ...folders])]);
    setTarget(undefined);
    setFile(pointed.path);
  }, [pointed]);
  return (
    <div className="your-ai-screen">
      <section
        className="you-panel you-folder chrome"
        aria-label={t('irori agent のフォルダ', "The irori agent's folder")}
      >
        <header className="you-head">
          <div className="you-identity">
            <button
              className="icon-button"
              aria-label={t('irori mode に戻る', 'Back to irori mode')}
              title={t('irori mode に戻る', 'Back to irori mode')}
              onClick={onBack}
            >
              <Icon name="back" size={16} />
            </button>
            <span className="you-orb" aria-hidden="true">
              <Icon name="sparkles" size={16} strokeWidth={2.1} />
            </span>
            <span className="you-names">
              <h1>{t('irori agent', 'irori agent')}</h1>
              <PathText path={you.root} className="you-root" />
            </span>
          </div>
          <div className="you-chips">
            <span className="you-chip">
              <Icon name="sparkles" size={13} />
              {agentNames[agent]}
            </span>
          </div>
        </header>
        <div className="you-folder-settings">
          <IroriAgentFolderSection
            workspaceId={workspaceId}
            showPath={false}
            onChanged={onFolderChanged}
          />
        </div>
        <div className="you-tree-section">
          <div className="you-tree-heading">
            <h2>
              <Icon name="schema" size={15} strokeWidth={1.9} />
              Schema
            </h2>
            {missingSkills.length > 0 && (
              <button
                className="you-action"
                disabled={running || adding}
                aria-label={t('標準スキルを追加', 'Add the standard skills')}
                title={`${t('標準スキルを追加', 'Add the standard skills')}: ${missingSkills.join(', ')}`}
                onClick={() => {
                  setAdding(true);
                  void onAddSkills()
                    .then(reread)
                    .finally(() => setAdding(false));
                }}
              >
                <Icon name="plus" size={14} />
              </button>
            )}
            <button
              className="you-action"
              aria-pressed={schemaFiles}
              aria-label={t('ファイルとして表示', 'Show as files')}
              title={t('ファイルとして表示', 'Show as files')}
              onClick={() => setSchemaFiles((value) => !value)}
            >
              <Icon name={schemaFiles ? 'sliders' : 'folder'} size={14} />
            </button>
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
            {schemaFiles ? (
              <Folder
                directory=""
                depth={0}
                reads={reads}
                open={open}
                file={target ? '' : file}
                onToggle={toggle}
                onShow={show}
              />
            ) : (
              <SchemaList
                scopeId={you.id}
                revision={reads}
                selected={target}
                locked={running}
                onSelect={setTarget}
                onOpenFile={(entry) => show(entry.path)}
              />
            )}
          </div>
        </div>
      </section>
      {target ? (
        <div className="you-stage on-stage">
          <SchemaEditor
            scopeId={you.id}
            target={target}
            locked={running}
            revision={reads}
            onSelect={(next) => (next ? setTarget(next) : show(file))}
            onClose={() => show(file)}
          />
        </div>
      ) : (
        <FileView path={file} reads={reads} />
      )}
      <section
        className="you-panel you-brains chrome"
        aria-label={t('vault agent', 'vault agents')}
      >
        <header className="you-brains-head">
          <Icon name="users" size={16} />
          <h2>{t('vault agent', 'vault agents')}</h2>
          <span className="you-count">{spaces.length}</span>
        </header>
        <div className="you-brains-body">
          {!spaces.length ? (
            <p className="you-brains-note">
              {t('このワークスペースに vault がありません。', 'This workspace has no vault yet.')}
            </p>
          ) : (
            <div className="you-brain-list" role="list">
              {spaces.map((space) => {
                const brain = agents.get(space.scopeId);
                return (
                  <div key={space.scopeId} className="you-brain-row" role="listitem">
                    <BrainTile space={space} size={26} radius={8} />
                    <span className="you-brain-names">
                      <strong>{`${space.name} agent`}</strong>
                      <small>{brain?.agent ?? '…'}</small>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {brains.error && (
            <p className="you-brains-note error" role="alert">
              {message(brains.error)}
            </p>
          )}
        </div>
        <footer className="you-update">
          <p className="you-update-state" role="status">
            {running && (
              <>
                <Icon name="loader" size={12} className="you-spin" />
                {t('作業中…', 'Working…')}
              </>
            )}
          </p>
        </footer>
      </section>
    </div>
  );
}
