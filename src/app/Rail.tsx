import { Fragment, useState, type ReactNode } from 'react';
import { ContextMenu } from '@base-ui/react/context-menu';
import type { HibachiGroup, Space } from '../domain/types';
import {
  joinGroup,
  leaveGroup,
  railItems,
  renameGroup,
  startGroup,
  toggleGroup,
  ungroup,
} from '../domain/hibachi-groups';
import { t } from '../domain/i18n';
import { appIcon, iroriModeIcon, routinesIcon } from './branding';
import { BrainTile } from './BrainTile';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { shortcut } from './shortcuts';

export type BrainAiState = 'running' | 'waiting' | 'idle';

export function aiStateWords(state: BrainAiState) {
  return {
    running: t('実行中', 'Running'),
    waiting: t('許可待ち', 'Needs approval'),
    idle: t('待機', 'Idle'),
  }[state];
}

/**
 * The workspace's brains in their owner's order, some gathered into named
 * groups that open and close, with the way back to the workspace choice, the
 * Overview, routines, adding a brain, search and settings.
 */
export function Rail({
  spaces,
  activeId,
  overview,
  routines,
  aiState,
  locked,
  homeDisabled,
  addDisabled,
  searchDisabled,
  onHome,
  onOverview,
  onRoutines,
  onSelect,
  onAdd,
  onSearch,
  groups,
  onGroups,
  settings,
}: {
  spaces: Space[];
  activeId?: string;
  /** The Overview is on show instead of a brain. */
  overview: boolean;
  /** The workspace's routines are on show. */
  routines: boolean;
  aiState: (scopeId: string) => BrainAiState;
  /** Another brain cannot be chosen now (a send or a connection is in progress). */
  locked: boolean;
  homeDisabled: boolean;
  addDisabled: boolean;
  searchDisabled: boolean;
  onHome: () => void;
  onOverview: () => void;
  onRoutines: () => void;
  onSelect: (space: Space) => void;
  onAdd: () => void;
  onSearch: () => void;
  /** The workspace's named groups of hibachis, each opened or closed in the rail. */
  groups: HibachiGroup[];
  onGroups: (groups: HibachiGroup[]) => void;
  settings: ReactNode;
}) {
  const byId = new Map(spaces.map((space) => [space.scopeId, space]));
  const [naming, setNaming] = useState<{ scopeId?: string; groupId?: string; name: string }>();
  // A hibachi in the rail; its menu gathers it into a named group or takes it out.
  const slot = (space: Space, groupId?: string) => {
    const active = !overview && space.scopeId === activeId;
    const state = aiState(space.scopeId);
    return (
      <ContextMenu.Root key={space.scopeId}>
        <ContextMenu.Trigger
          className={`rail-slot rail-brain-slot ${active ? 'active' : ''}`}
          data-ai={state}
        >
          {active && <span className="rail-bar" aria-hidden="true" />}
          <button
            className="rail-brain"
            aria-label={t(
              `${space.name}・AI ${aiStateWords(state)}`,
              `${space.name} · AI ${aiStateWords(state).toLowerCase()}`,
            )}
            aria-current={active ? 'true' : undefined}
            disabled={locked && !active}
            onClick={() => onSelect(space)}
          >
            {state === 'running' && (
              <span className="rail-ring" aria-hidden="true">
                <span />
              </span>
            )}
            <BrainTile space={space} size={40} radius={12} ring={active ? 'active' : 'panel'} />
            {state === 'waiting' && <span className="rail-dot" aria-hidden="true" />}
          </button>
          <span className="rail-label" aria-hidden="true">
            {space.name}
            <span className="rail-label-state">
              <i />
              {aiStateWords(state)}
            </span>
          </span>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup className="menu">
              <ContextMenu.Item onClick={() => setNaming({ scopeId: space.scopeId, name: '' })}>
                <Icon name="folder" size={15} />
                {t('新しいグループ', 'New group')}
              </ContextMenu.Item>
              {groups
                .filter((group) => group.id !== groupId)
                .map((group) => (
                  <ContextMenu.Item
                    key={group.id}
                    onClick={() => onGroups(joinGroup(groups, space.scopeId, group.id))}
                  >
                    <Icon name="arrow" size={15} />
                    {t(`「${group.name}」に入れる`, `Move to “${group.name}”`)}
                  </ContextMenu.Item>
                ))}
              {groupId && (
                <ContextMenu.Item onClick={() => onGroups(leaveGroup(groups, space.scopeId))}>
                  <Icon name="minus" size={15} />
                  {t('グループから外す', 'Remove from group')}
                </ContextMenu.Item>
              )}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  };
  return (
    <nav className="rail chrome" aria-label={t('hibachi', 'hibachis')}>
      <button
        className="rail-home"
        aria-label={t('ワークスペースを選択', 'Choose a workspace')}
        title={t('ワークスペースを選択', 'Choose a workspace')}
        disabled={homeDisabled}
        onClick={onHome}
      >
        <img src={appIcon} alt="" width="28" height="28" />
      </button>
      <div className={`rail-slot ${overview ? 'active' : ''}`}>
        {overview && <span className="rail-bar" aria-hidden="true" />}
        <button
          className="rail-button rail-overview"
          aria-label={t('irori mode', 'irori mode')}
          aria-current={overview ? 'page' : undefined}
          disabled={!spaces.length}
          onClick={onOverview}
        >
          <img src={iroriModeIcon} alt="" width="40" height="40" />
        </button>
        <span className="rail-label" aria-hidden="true">
          {t('irori mode', 'irori mode')}
        </span>
      </div>
      <div className={`rail-slot ${routines ? 'active' : ''}`}>
        {routines && <span className="rail-bar" aria-hidden="true" />}
        <button
          className="rail-button rail-routines"
          aria-label={t('ルーティン', 'Routines')}
          aria-current={routines ? 'page' : undefined}
          onClick={onRoutines}
        >
          <img src={routinesIcon} alt="" width="40" height="40" />
        </button>
        <span className="rail-label" aria-hidden="true">
          {t('ルーティン', 'Routines')}
        </span>
      </div>
      <span className="rail-rule" aria-hidden="true" />
      {railItems(
        spaces.map((space) => space.scopeId),
        groups,
      ).map((item) => {
        if (item.kind === 'hibachi') return slot(byId.get(item.scopeId)!);
        const members = item.group.scopeIds.map((scopeId) => byId.get(scopeId)!);
        const states = members.map((space) => aiState(space.scopeId));
        const state: BrainAiState = states.includes('waiting')
          ? 'waiting'
          : states.includes('running')
            ? 'running'
            : 'idle';
        const holdsActive =
          !overview && members.some((space) => space.scopeId === activeId) && !item.group.open;
        const toggle = (
          <ContextMenu.Root>
            <ContextMenu.Trigger
              className={`rail-slot rail-group-slot ${holdsActive ? 'active' : ''}`}
              data-ai={state}
            >
              {holdsActive && <span className="rail-bar" aria-hidden="true" />}
              <button
                className={`rail-group ${item.group.open ? 'open' : ''}`}
                aria-label={item.group.name}
                aria-expanded={item.group.open}
                onClick={() => onGroups(toggleGroup(groups, item.group.id))}
              >
                {item.group.open ? (
                  <Icon name="folderOpen" size={18} />
                ) : (
                  <>
                    {state === 'running' && (
                      <span className="rail-ring" aria-hidden="true">
                        <span />
                      </span>
                    )}
                    <span className="rail-folder" aria-hidden="true">
                      {members.slice(0, 4).map((space) => (
                        <BrainTile key={space.scopeId} space={space} size={15} radius={5} />
                      ))}
                    </span>
                    {state === 'waiting' && <span className="rail-dot" aria-hidden="true" />}
                  </>
                )}
              </button>
              <span className="rail-label" aria-hidden="true">
                {item.group.name}
                {!item.group.open && state !== 'idle' && (
                  <span className="rail-label-state">
                    <i />
                    {aiStateWords(state)}
                  </span>
                )}
              </span>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Positioner>
                <ContextMenu.Popup className="menu">
                  <ContextMenu.Item
                    onClick={() => setNaming({ groupId: item.group.id, name: item.group.name })}
                  >
                    <Icon name="penLine" size={15} />
                    {t('名前を変更', 'Rename')}
                  </ContextMenu.Item>
                  <ContextMenu.Item onClick={() => onGroups(ungroup(groups, item.group.id))}>
                    <Icon name="close" size={15} />
                    {t('グループを解除', 'Ungroup')}
                  </ContextMenu.Item>
                </ContextMenu.Popup>
              </ContextMenu.Positioner>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        );
        return item.group.open ? (
          <div
            key={item.group.id}
            className="rail-group-open"
            role="group"
            aria-label={item.group.name}
          >
            {toggle}
            {members.map((space) => slot(space, item.group.id))}
          </div>
        ) : (
          <Fragment key={item.group.id}>{toggle}</Fragment>
        );
      })}
      <button
        className="rail-add"
        aria-label={t('hibachi を追加', 'Add a hibachi')}
        title={t('hibachi を追加', 'Add a hibachi')}
        disabled={addDisabled}
        onClick={onAdd}
      >
        <Icon name="plus" size={17} />
      </button>
      <span className="rail-spacer" />
      <button
        className="rail-button"
        aria-label={t(`検索（${shortcut('K')}）`, `Search (${shortcut('K')})`)}
        title={t(`検索（${shortcut('K')}）`, `Search (${shortcut('K')})`)}
        disabled={searchDisabled}
        onClick={onSearch}
      >
        <Icon name="search" size={18} />
      </button>
      {settings}
      {naming && (
        <Dialog
          label={
            naming.groupId
              ? t('グループ名を変更', 'Rename group')
              : t('新しいグループ', 'New group')
          }
          onClose={() => setNaming(undefined)}
        >
          <form
            className="modal"
            onSubmit={(event) => {
              event.preventDefault();
              const name = naming.name.trim();
              if (!name) return;
              onGroups(
                naming.groupId
                  ? renameGroup(groups, naming.groupId, name)
                  : startGroup(groups, naming.scopeId!, name, crypto.randomUUID()),
              );
              setNaming(undefined);
            }}
          >
            <h2>
              {naming.groupId
                ? t('グループ名を変更', 'Rename group')
                : t('新しいグループ', 'New group')}
            </h2>
            <input
              aria-label={t('グループ名', 'Group name')}
              placeholder={t('グループ名', 'Group name')}
              value={naming.name}
              maxLength={120}
              required
              autoFocus
              onChange={(event) => setNaming({ ...naming, name: event.target.value })}
            />
            <div className="actions">
              <button type="button" onClick={() => setNaming(undefined)}>
                {t('キャンセル', 'Cancel')}
              </button>
              <button className="primary">
                {naming.groupId ? t('変更', 'Rename') : t('作成', 'Create')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </nav>
  );
}
