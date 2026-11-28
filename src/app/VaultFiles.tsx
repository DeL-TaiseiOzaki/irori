import { lazy, Suspense, useEffect, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import {
  Group as PaneGroup,
  Panel as Pane,
  Separator as PaneSeparator,
  useDefaultLayout,
} from 'react-resizable-panels';
import type { Entry, Space } from '../domain/types';
import { classify } from '../domain/scopes';
import { scopeRevision, type ScopeRevisions } from '../domain/revisions';
import { t } from '../domain/i18n';
import { BrainTile } from './BrainTile';
import { VaultSections } from './BrainPanel';
import { Crumbs, fileCrumbs } from './NoteBar';
import { Icon } from './Icon';
import { RemoteVaultPlace } from './RemoteHosts';
import type { PreviewTarget } from './StagePreview';
import { layoutStorage } from './device-settings';
import { useResource } from './useResource';
import { useLanguage } from './useLanguage';
import { Button, IconButton } from './controls';

const StagePreview = lazy(() =>
  import('./StagePreview').then((module) => ({ default: module.StagePreview })),
);

const host = window.irori;
const noConnections: never[] = [];

/** The file irori mode's files view shows, and where in it to look first. */
export type OverviewFile = { scopeId: string; path: string; target?: PreviewTarget };

/**
 * irori mode's files view (ADR 068): a vault's trees and the file chosen in them,
 * shown as the vault has it, while the irori agent's columns stay beside. Nothing
 * is changed here; **vault で編集** opens the file in its vault.
 */
export function VaultFiles({
  spaces,
  file,
  revisions,
  onOpen,
  onEdit,
  onClose,
  onError,
}: {
  spaces: Space[];
  file?: OverviewFile;
  revisions: ScopeRevisions;
  /** A row of a tree chosen: irori mode shows it, or it goes to its application. */
  onOpen: (space: Space, entry: Entry) => void;
  /** Opens the file on show in its vault, to edit it. */
  onEdit: (file: OverviewFile) => void;
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  useLanguage();
  // The vault whose trees are shown: the file's, until another is chosen.
  const [chosen, setChosen] = useState(file?.scopeId);
  useEffect(() => {
    if (file) setChosen(file.scopeId);
  }, [file?.scopeId, file?.path, file?.target?.n]);
  const space = spaces.find((item) => item.scopeId === chosen) ?? spaces[0];
  const fileSpace = file && spaces.find((item) => item.scopeId === file.scopeId);
  const revision = scopeRevision(revisions, space?.scopeId);
  const rootsRead = useResource(() => host.entries(space!.scopeId, ''), [space?.scopeId], {
    enabled: !!space,
    refresh: revision,
  });
  const connections = useResource(() => host.cloudConnections(space!.scopeId), [space?.scopeId], {
    enabled: !!space,
    refresh: revision,
    interval: 5000,
  });
  const layout = useDefaultLayout({
    id: 'irori-overview-files',
    panelIds: ['overview-files-tree', 'overview-files-page'],
    onlySaveAfterUserInteractions: true,
    storage: layoutStorage,
  });
  if (!space) return null;
  const others = spaces.filter((item) => item.scopeId !== space.scopeId);
  const identity = (
    <>
      <BrainTile space={space} size={34} radius={10} />
      <span className="brain-names side-names">
        <strong>{space.name}</strong>
        {space.host && (
          <small>
            <RemoteVaultPlace space={space} />
          </small>
        )}
      </span>
    </>
  );
  return (
    <PaneGroup
      className="vault-files"
      orientation="horizontal"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <Pane
        id="overview-files-tree"
        className="vault-files-tree-pane"
        defaultSize={260}
        minSize={200}
        maxSize={440}
      >
        <section
          className="brain-panel side-panel vault-files-tree chrome"
          aria-label={t(`${space.name} のファイル`, `Files of ${space.name}`)}
        >
          <header className="brain-header">
            <div className="brain-identity">
              {others.length ? (
                <Menu.Root modal={false}>
                  <Menu.Trigger
                    className="brain-home-link"
                    aria-label={t(`表示中の vault: ${space.name}`, `vault on show: ${space.name}`)}
                  >
                    {identity}
                    <Icon name="chevronDown" size={14} />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner side="bottom" align="start" sideOffset={4}>
                      <Menu.Popup className="menu">
                        {others.map((choice) => (
                          <Menu.Item key={choice.scopeId} onClick={() => setChosen(choice.scopeId)}>
                            <BrainTile space={choice} size={16} radius={4} />
                            {choice.name}
                          </Menu.Item>
                        ))}
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              ) : (
                <span className="brain-home-link">{identity}</span>
              )}
            </div>
          </header>
          <VaultSections
            key={space.scopeId}
            space={space}
            roots={
              rootsRead.data || rootsRead.error
                ? { entries: rootsRead.data ?? [], error: rootsRead.error }
                : undefined
            }
            revision={revision}
            selected={file}
            connections={connections.data ?? noConnections}
            onOpen={onOpen}
          />
        </section>
      </Pane>
      <PaneSeparator
        className="island-handle"
        aria-label={t('ファイル一覧の幅', 'File list width')}
      />
      <Pane id="overview-files-page" className="vault-files-page-pane" minSize={320}>
        <section className="vault-files-page on-stage" aria-label={t('ファイル', 'File')}>
          {file && fileSpace ? (
            <>
              <header className="stage-bar">
                <Crumbs
                  space={fileSpace}
                  {...fileCrumbs(fileSpace, classify(fileSpace, file.path), file.path)}
                />
                <div className="stage-actions">
                  <span className="save-state" role="status">
                    <Icon name="file" size={13} />
                    {t('閲覧のみ', 'Read only')}
                  </span>
                  <Button
                    variant="ghost"
                    size="md"
                    label={t('vault で編集', 'Edit in vault')}
                    icon={<Icon name="penLine" size={14} />}
                    onClick={() => onEdit(file)}
                  />
                  <IconButton
                    label={t('ファイルを閉じる', 'Close the file')}
                    title={t('閉じる', 'Close')}
                    icon={<Icon name="close" size={16} />}
                    onClick={onClose}
                  />
                </div>
              </header>
              <Suspense fallback={<p className="hint">{t('開いています…', 'Opening…')}</p>}>
                <StagePreview
                  key={`${file.scopeId}:${file.path}`}
                  space={fileSpace}
                  path={file.path}
                  revision={scopeRevision(revisions, file.scopeId)}
                  target={file.target}
                  onError={onError}
                />
              </Suspense>
            </>
          ) : (
            <p className="vault-files-empty">
              {t(
                'ファイルを選ぶと、ここで読めます。irori agent の列はそのまま使えます。',
                'Choose a file to read it here. The irori agent’s columns stay as they are.',
              )}
            </p>
          )}
        </section>
      </Pane>
    </PaneGroup>
  );
}
