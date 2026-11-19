import { Fragment, memo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '@base-ui/react/context-menu';
import type { WorkspaceProfile } from '../domain/types';
import type { WorkspaceTab } from '../domain/workspace-tabs';
import { t } from '../domain/i18n';
import { Icon } from './Icon';
import { useLanguage } from './useLanguage';

/** How far a held tab moves before it is dragged rather than clicked, in CSS pixels. */
const dragFrom = 6;
/** How far below the tabs a dragged tab is out of the strip, as in a browser. */
const outBelow = 24;

type Point = { x: number; y: number };
const onScreen = (event: PointerEvent): Point => ({
  x: Math.round(event.screenX),
  y: Math.round(event.screenY),
});

/** The other tabs of the strip as a drag along it began (ADR 065). */
type Places = { others: DOMRect[]; from: number; origin: number };
/** The place among the other tabs a tab let go `x` across the window takes. */
const placeAt = (places: Places, x: number) =>
  places.others.filter((box) => box.left + box.width / 2 < x).length;
/** Where across the strip the mark stands for a place: in the gap before that tab. */
function slotOf(places: Places, index: number) {
  const { others, origin } = places;
  const edge = index < others.length ? others[index].left - 1 : others[others.length - 1].right + 1;
  return edge - origin;
}

/**
 * Where a tab let go `x` across the window joins this window's tabs (ADR 064): after
 * every tab whose middle is left of it.
 */
export function stripIndexAt(x: number) {
  return [
    ...document.querySelectorAll('.workspace-tab-list > .workspace-tab:not([data-incoming])'),
  ].filter((tab) => {
    const box = tab.getBoundingClientRect();
    return box.left + box.width / 2 < x;
  }).length;
}

/**
 * The open workspaces along the window's top, as a browser keeps its pages:
 * one on show, the others still running. + shows the start screen to open another.
 * A tab dragged along the strip takes the place it is let go at (ADR 065). One dragged
 * out of it, below it or off the window, joins the tabs of the window it is let go on,
 * which shows where while it is over them (ADR 064), or else opens in a window of its
 * own while two or more are open (ADR 063). A tab's right click offers what a browser's
 * does: duplicate it, move it to a new window, close it, the others or those to its
 * right (ADR 067).
 * Memoised: it re-renders for its own data, not for every keystroke in the editor.
 */
export const WorkspaceTabs = memo(function WorkspaceTabs({
  tabs,
  shown,
  running,
  waiting,
  disabled,
  moving,
  incoming,
  onShow,
  onClose,
  onDuplicate,
  onMoveOut,
  onDragOver,
  onReorder,
  onAdd,
}: {
  tabs: WorkspaceTab[];
  /** The key of the tab on show; none while the start screen is. */
  shown?: string;
  running: string[];
  waiting: string[];
  disabled: boolean;
  /** The keys of tabs on their way to another window: they stay until it shows them. */
  moving: string[];
  /** A tab dragged out of another window, over these: where it would join them. */
  incoming?: { index: number; name: string };
  onShow: (tab: WorkspaceTab) => void;
  /** Closes the tabs these keys name. */
  onClose: (keys: string[]) => void;
  onDuplicate: (tab: WorkspaceTab) => void;
  /** A tab let go of out of the strip at a point of the screen, or moved from its menu. */
  onMoveOut: (tab: WorkspaceTab, at?: Point) => void;
  /** Where a tab dragged out of the strip is on the screen; none once it is not. */
  onDragOver: (drag?: { name: string; at: Point }) => void;
  /** A tab let go along the strip, before the `index`-th of the other tabs. */
  onReorder: (tab: WorkspaceTab, index: number) => void;
  onAdd: () => void;
}) {
  useLanguage();
  // The tab held down, where, and the strip's foot; `dragged` once it moved far enough.
  // `places` are the other tabs as they stood when the drag began, and `from` the place
  // among them the tab already has (ADR 065).
  const held = useRef<{
    key: string;
    x: number;
    y: number;
    foot: number;
    dragged: boolean;
    places?: Places;
  }>(undefined);
  // A drag ends with a click on the tab it started on, in the same task; it shows nothing.
  const swallow = useRef(false);
  const [drag, setDrag] = useState<{
    key: string;
    name: string;
    x: number;
    y: number;
    out: boolean;
    /** Where across the strip the tab would go, when that is another place. */
    slot?: number;
  }>();
  // Out of the strip, the host learns where the tab is once a frame, so the window whose
  // tabs are under it shows where it would join them. `told` once it was told any.
  const pointing = useRef<{ frame?: number; next?: { name: string; at: Point }; told: boolean }>({
    told: false,
  });
  function point(next?: { name: string; at: Point }) {
    const now = pointing.current;
    now.next = next;
    if ((!next && !now.told) || now.frame !== undefined) return;
    now.frame = requestAnimationFrame(() => {
      now.frame = undefined;
      now.told = !!now.next;
      onDragOver(now.next);
    });
  }
  /** Stops telling the host, and takes the place shown in another window away. */
  function stopPointing() {
    const now = pointing.current;
    if (now.frame !== undefined) cancelAnimationFrame(now.frame);
    if (now.told) onDragOver();
    pointing.current = { told: false };
  }
  const state = (tab: WorkspaceProfile) =>
    tab.scopeIds.some((id) => waiting.includes(id))
      ? 'waiting'
      : tab.scopeIds.some((id) => running.includes(id))
        ? 'running'
        : undefined;
  const out = (event: PointerEvent, foot: number) =>
    event.clientY > foot + outBelow ||
    event.clientY < 0 ||
    event.clientX < 0 ||
    event.clientX > window.innerWidth;
  function hold(event: PointerEvent<HTMLButtonElement>, tab: WorkspaceTab) {
    if (disabled || event.button !== 0 || !event.isPrimary) return;
    // The pointer stays the tab's when it leaves the strip, or the window.
    event.currentTarget.setPointerCapture(event.pointerId);
    const foot = event.currentTarget.closest('nav')?.getBoundingClientRect().bottom ?? 0;
    held.current = { key: tab.key, x: event.clientX, y: event.clientY, foot, dragged: false };
  }
  function follow(event: PointerEvent, tab: WorkspaceTab) {
    const start = held.current;
    if (start?.key !== tab.key) return;
    if (!start.dragged && Math.hypot(event.clientX - start.x, event.clientY - start.y) < dragFrom)
      return;
    start.dragged = true;
    start.places ??= measure(event.currentTarget, tab.key);
    const away = out(event, start.foot);
    const index = away ? undefined : placeAt(start.places, event.clientX);
    setDrag({
      key: tab.key,
      name: tab.name,
      x: event.clientX,
      y: event.clientY,
      out: away,
      slot:
        index === undefined || index === start.places.from
          ? undefined
          : slotOf(start.places, index),
    });
    point(away ? { name: tab.name, at: onScreen(event) } : undefined);
  }
  /** The other tabs' places across the strip, and the one the dragged tab has among them. */
  function measure(button: Element, key: string): Places {
    const list = button.closest('.workspace-tab-list');
    const boxes = [
      ...(list?.querySelectorAll(':scope > .workspace-tab:not([data-incoming])') ?? []),
    ].map((tab) => tab.getBoundingClientRect());
    const from = tabs.findIndex((tab) => tab.key === key);
    const origin = (list?.getBoundingClientRect().left ?? 0) - (list?.scrollLeft ?? 0);
    return {
      others: boxes.filter((_, index) => index !== from),
      from,
      origin,
    };
  }
  function letGo(event: PointerEvent, tab: WorkspaceTab, cancelled = false) {
    const start = held.current;
    held.current = undefined;
    setDrag(undefined);
    // The place shown in another window goes, whatever the drop then does.
    stopPointing();
    if (start?.key !== tab.key || !start.dragged) return;
    swallow.current = true;
    setTimeout(() => (swallow.current = false));
    if (cancelled) return;
    if (out(event, start.foot)) return onMoveOut(tab, onScreen(event));
    const index = start.places && placeAt(start.places, event.clientX);
    if (index !== undefined && index !== start.places?.from) onReorder(tab, index);
  }
  // A window's one tab moves only onto another window's tabs (ADR 064).
  const alone = tabs.length - moving.length < 2;
  const joining = incoming && (
    <div className="workspace-tab" data-incoming aria-hidden="true">
      <span>{incoming.name}</span>
    </div>
  );
  return (
    <nav className="workspace-tabs chrome" aria-label={t('ワークスペース', 'Workspaces')}>
      <div className="workspace-tab-list">
        {drag?.slot !== undefined && (
          <i className="workspace-tab-slot" style={{ left: drag.slot }} aria-hidden="true" />
        )}
        {tabs.map((tab, index) => {
          const ai = state(tab);
          const current = tab.key === shown;
          const away = moving.includes(tab.key);
          const others = tabs.filter(
            (other) => other.key !== tab.key && !moving.includes(other.key),
          );
          const right = tabs.slice(index + 1).filter((other) => !moving.includes(other.key));
          return (
            <Fragment key={tab.key}>
              {incoming?.index === index && joining}
              <ContextMenu.Root>
                <ContextMenu.Trigger
                  className="workspace-tab"
                  data-current={current || undefined}
                  data-moving={away || drag?.key === tab.key || undefined}
                >
                  <button
                    aria-current={current ? 'page' : undefined}
                    className="workspace-tab-name"
                    disabled={disabled || away}
                    title={tab.name}
                    aria-label={
                      ai === 'waiting'
                        ? t(`${tab.name}・許可待ち`, `${tab.name} · waiting`)
                        : ai === 'running'
                          ? t(`${tab.name}・実行中`, `${tab.name} · running`)
                          : tab.name
                    }
                    onPointerDown={(event) => hold(event, tab)}
                    onPointerMove={(event) => follow(event, tab)}
                    onPointerUp={(event) => letGo(event, tab)}
                    onPointerCancel={(event) => letGo(event, tab, true)}
                    // The system took the pointer away (another window came to the front).
                    onLostPointerCapture={(event) => letGo(event, tab, true)}
                    onClick={() => {
                      if (swallow.current) swallow.current = false;
                      else onShow(tab);
                    }}
                  >
                    {ai && <i className="workspace-tab-ai" data-ai={ai} aria-hidden="true" />}
                    <span>{tab.name}</span>
                  </button>
                  <button
                    className="workspace-tab-close"
                    disabled={disabled || away}
                    title={t('閉じる', 'Close')}
                    aria-label={t(`${tab.name} を閉じる`, `Close ${tab.name}`)}
                    onClick={() => onClose([tab.key])}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Positioner>
                    <ContextMenu.Popup
                      className="menu"
                      aria-label={t(`${tab.name} のタブ`, `${tab.name} tab`)}
                    >
                      <ContextMenu.Item
                        disabled={disabled || away}
                        onClick={() => onDuplicate(tab)}
                      >
                        <Icon name="copy" size={15} />
                        {t('タブを複製', 'Duplicate tab')}
                      </ContextMenu.Item>
                      {/* A window's one tab stays (ADR 063); it can only join another's. */}
                      <ContextMenu.Item
                        disabled={disabled || away || alone}
                        onClick={() => onMoveOut(tab)}
                      >
                        <Icon name="move" size={15} />
                        {t('新しいウィンドウに移動', 'Move tab to new window')}
                      </ContextMenu.Item>
                      <ContextMenu.Separator className="menu-separator" />
                      <ContextMenu.Item
                        disabled={disabled || away}
                        onClick={() => onClose([tab.key])}
                      >
                        <Icon name="close" size={15} />
                        {t('タブを閉じる', 'Close tab')}
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        disabled={disabled || !others.length}
                        onClick={() => onClose(others.map((other) => other.key))}
                      >
                        <span className="menu-icon-blank" aria-hidden="true" />
                        {t('他のタブを閉じる', 'Close other tabs')}
                      </ContextMenu.Item>
                      <ContextMenu.Item
                        disabled={disabled || !right.length}
                        onClick={() => onClose(right.map((other) => other.key))}
                      >
                        <span className="menu-icon-blank" aria-hidden="true" />
                        {t('右側のタブを閉じる', 'Close tabs to the right')}
                      </ContextMenu.Item>
                    </ContextMenu.Popup>
                  </ContextMenu.Positioner>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            </Fragment>
          );
        })}
        {incoming && incoming.index >= tabs.length && joining}
      </div>
      <button
        className="workspace-tab-add"
        disabled={disabled}
        title={t('ワークスペースを開く', 'Open a workspace')}
        aria-label={t('ワークスペースを開く', 'Open a workspace')}
        aria-pressed={!shown}
        onClick={onAdd}
      >
        <Icon name="plus" size={15} />
      </button>
      {drag &&
        createPortal(
          <div
            className="workspace-tab-drag"
            data-out={drag.out || undefined}
            style={{ left: drag.x, top: drag.y }}
            aria-hidden="true"
          >
            <span>{drag.name}</span>
            {drag.out && (
              <small>
                {alone
                  ? t('ほかのウィンドウのタブの上で離す', "Let go on another window's tabs")
                  : t('新しいウィンドウで開く', 'Opens in a new window')}
              </small>
            )}
          </div>,
          document.body,
        )}
    </nav>
  );
});
