import type { ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import type { Layer, Space } from '../domain/types';
import { t } from '../domain/i18n';
import { BrainTile } from './BrainTile';
import { layerNames } from './BrainPanel';
import { Icon, type IconName } from './Icon';

const layerIcons: Record<Layer, IconName> = {
  schema: 'schema',
  Knowledge_Base: 'book',
  contents: 'cloud',
};

export type Crumb = { icon?: IconName; label: string; className?: string };

/** A file's place as crumbs: its layer, then its folders; the layer's own root is not repeated. */
export function fileCrumbs(space: Space | undefined, layer: Layer, path: string) {
  const parts = path.split('/');
  const file = parts.pop()!.replace(/\.md$/i, '');
  const folders =
    layer === 'Knowledge_Base' && parts[0] === 'Knowledge_Base'
      ? parts.slice(1)
      : layer === 'contents' && space?.contents.includes(parts[0])
        ? parts.slice(1)
        : parts;
  const items: Crumb[] = [
    { icon: layerIcons[layer], label: layerNames[layer], className: `layer ${layer}` },
    ...folders.map((folder) => ({ label: folder, className: 'folder' })),
  ];
  return { items, here: file };
}

/** Where the stage is: the brain, then the trail to what is shown. */
export function Crumbs({
  space,
  items,
  here,
  title,
}: {
  space?: Space;
  items: Crumb[];
  here?: string;
  title?: string;
}) {
  return (
    <nav className="crumbs" aria-label={t('場所', 'Location')} title={title}>
      {space && (
        <span className="crumb brain">
          <BrainTile space={space} size={20} radius={6} ring="stage" />
          {space.name}
        </span>
      )}
      {items.map((item, index) => (
        <span key={index} className={`crumb ${item.className ?? ''}`}>
          {(space || index > 0) && <Icon name="chevron" size={12} className="crumb-separator" />}
          {item.icon && <Icon name={item.icon} size={14} strokeWidth={1.9} />}
          <span className="crumb-label">{item.label}</span>
        </span>
      ))}
      {here && (
        <strong className="crumb here" aria-current="page">
          <Icon name="chevron" size={12} className="crumb-separator" />
          <span className="crumb-label">{here}</span>
        </strong>
      )}
    </nav>
  );
}

/** A 30 px icon button on the stage. */
export function StageButton({
  icon,
  label,
  onClick,
  disabled,
  children,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      className="stage-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
      {children}
    </button>
  );
}

/** A note's details: where it is, and which lines a person wrote. */
export function NoteInfo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="stage-button" aria-label={label} title={label}>
        <Icon name="info" size={16} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup className="stage-popover note-info">{children}</Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The note's other actions, each shown only where it applies. */
export function NoteMenu({ children }: { children: ReactNode }) {
  const label = t(
    'その他（名前・場所、削除、再読み込み）',
    'More (name & location, delete, reload)',
  );
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="stage-button" aria-label={label} title={label}>
        <Icon name="more" size={16} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6}>
          <Menu.Popup className="menu on-stage">{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Opens and closes the brain's AI; closed, it is the AI's own ember button. */
export function AiToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return open ? (
    <button
      className="ai-toggle open"
      aria-pressed="true"
      aria-label={t('AIパネルを閉じる', 'Close AI panel')}
      title={t('AI パネル', 'AI panel')}
      onClick={onToggle}
    >
      <Icon name="sparkles" size={14} />
      AI
    </button>
  ) : (
    <button className="ai-toggle" title={t('AI に相談', 'Ask AI')} onClick={onToggle}>
      <Icon name="sparkles" size={14} />
      {t('AIに相談', 'Ask AI')}
    </button>
  );
}
