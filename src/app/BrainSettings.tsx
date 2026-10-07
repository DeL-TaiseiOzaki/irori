import { useState, type CSSProperties } from 'react';
import {
  brainAppearance,
  brainColorName,
  brainColors,
  brainGlyphs,
  categoryName,
  graphemes,
  type BrainColor,
  type BrainGlyph,
  type BrainLook,
} from '../domain/brains';
import type { Category, LayerFolderRename, Space } from '../domain/types';
import {
  defaultLayerLabel,
  layerFolder,
  layerFolderProblem,
  layerLabel,
  type NamedLayer,
} from '../domain/layers';
import { t } from '../domain/i18n';
import { BrainTile, glyphs } from './BrainTile';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { errorText } from './ErrorMessage';

const host = window.irori;
type IconKind = 'glyph' | 'text' | 'image';

// Names read at render time, so they follow the interface language.
function glyphName(glyph: BrainGlyph) {
  return {
    book: t('本', 'Book'),
    flask: t('フラスコ', 'Flask'),
    rocket: t('ロケット', 'Rocket'),
    landmark: t('建物', 'Landmark'),
    feather: t('羽根', 'Feather'),
    compass: t('コンパス', 'Compass'),
    bulb: t('電球', 'Light bulb'),
    globe: t('地球', 'Globe'),
    map: t('地図', 'Map'),
    users: t('人々', 'People'),
    user: t('人', 'Person'),
    building: t('ビル', 'Building'),
    briefcase: t('かばん', 'Briefcase'),
    code: t('コード', 'Code'),
    database: t('データベース', 'Database'),
    shield: t('盾', 'Shield'),
    star: t('星', 'Star'),
    heart: t('ハート', 'Heart'),
    leaf: t('葉', 'Leaf'),
    anchor: t('錨', 'Anchor'),
    target: t('的', 'Target'),
    box: t('箱', 'Box'),
    music: t('音楽', 'Music'),
    mountain: t('山', 'Mountain'),
  }[glyph];
}

function Segments<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="segments">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label key={option.value} data-checked={option.value === value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Removes a hibachi from irori, and its folder too when the person asks for that. */
export function RemoveHibachi({
  space,
  onRemoved,
  onClose,
  beforeRemove,
}: {
  space: Space;
  onRemoved: () => void;
  onClose: () => void;
  beforeRemove?: () => Promise<boolean>;
}) {
  const [trash, setTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = t(`${space.name} を削除`, `Remove ${space.name}`);
  async function remove() {
    setBusy(true);
    setError('');
    try {
      if (beforeRemove && !(await beforeRemove())) return;
      await host.removeSpace(space.scopeId, trash);
      onRemoved();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label={label} busy={busy} onClose={onClose}>
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          void remove();
        }}
      >
        <h2>{label}</h2>
        <p>{t('irori とワークスペースから外します。', 'It leaves irori and its workspaces.')}</p>
        <label>
          <input
            type="checkbox"
            checked={trash}
            disabled={busy}
            onChange={(event) => setTrash(event.target.checked)}
          />{' '}
          {t('フォルダもゴミ箱に移す', 'Also move the folder to the trash')}
        </label>
        <p className="hint mono">{space.root}</p>
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t('キャンセル', 'Cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {t('削除', 'Remove')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const namedLayers: NamedLayer[] = ['Knowledge_Base', 'contents'];
const layerIcons = { Knowledge_Base: 'book', contents: 'cloud' } as const;

/**
 * A brain's name, category, icon and colour, and the names of its Knowledge and
 * Contents layers and their folders. They are kept in the KB's
 * `.irori/scope.json`, so everyone who opens the brain sees the same tile.
 */
export function BrainSettings({
  space,
  spaces,
  onSaved,
  onClose,
  beforeRename,
  onRemoved,
}: {
  space: Space;
  /** The workspace's brains, for the rail preview. */
  spaces: Space[];
  /** `renamed` holds the layer folders the save renamed, in order. */
  onSaved: (space: Space, renamed: (LayerFolderRename & { layer: NamedLayer })[]) => void;
  onClose: () => void;
  /** Saves the open note before a folder it may be in moves; false stops the save. */
  beforeRename?: () => Promise<boolean>;
  /** The hibachi left irori; without it, the sheet offers no removal. */
  onRemoved?: () => void;
}) {
  const current = brainAppearance(space);
  const [name, setName] = useState(space.name);
  const [category, setCategory] = useState<Category | 'none'>(space.category ?? 'none');
  const [kind, setKind] = useState<IconKind>(current.mark.kind);
  const [glyph, setGlyph] = useState<BrainGlyph>(
    current.mark.kind === 'glyph' ? current.mark.glyph : 'book',
  );
  // The derived initial, offered when letters are chosen.
  const initial = brainAppearance({ scopeId: space.scopeId, name: space.name }).mark;
  const [text, setText] = useState(
    current.mark.kind === 'text' ? current.mark.text : initial.kind === 'text' ? initial.text : '',
  );
  const [picked, setPicked] = useState<{ bytes: Uint8Array; url: string }>();
  const [color, setColor] = useState<BrainColor>(current.color);
  // Whether the person chose an icon; an untouched one stays derived rather than written down.
  const [touched, setTouched] = useState({ icon: false });
  const [labels, setLabels] = useState(() => ({
    Knowledge_Base: space.labels?.Knowledge_Base ?? '',
    contents: space.labels?.contents ?? '',
  }));
  const [folders, setFolders] = useState(() => ({
    Knowledge_Base: layerFolder(space, 'Knowledge_Base'),
    contents: layerFolder(space, 'contents').split('/').at(-1)!,
  }));
  const folderProblems = Object.fromEntries(
    namedLayers.map((layer) => [layer, layerFolderProblem(folders[layer].trim()) ?? '']),
  ) as Record<NamedLayer, string>;
  const folderProblem = namedLayers.some((layer) => folderProblems[layer]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const textProblem =
    kind === 'text' && (!text.trim() || graphemes(text.trim()) > 2)
      ? t('1〜2 文字にしてください。', 'Use one or two characters.')
      : '';
  const imageMissing =
    kind === 'image' && !picked && !(current.mark.kind === 'image' && !touched.icon);
  const icon: BrainLook['icon'] = !touched.icon
    ? space.appearance?.icon
    : kind === 'glyph'
      ? { kind: 'glyph', glyph }
      : kind === 'text'
        ? { kind: 'text', text: text.trim() || '?' }
        : current.mark.kind === 'image'
          ? current.mark
          : undefined;
  const draft: Space = {
    ...space,
    labels,
    name: name.trim() || space.name,
    appearance: {
      icon: kind === 'image' && picked ? undefined : icon,
      color,
    },
  };
  const image = kind === 'image' ? picked?.url : undefined;
  const chooseIcon = (next: () => void) => {
    next();
    setTouched((value) => ({ ...value, icon: true }));
  };
  async function pick(file: File) {
    setError('');
    if (file.size > 2 * 1024 * 1024) {
      setError(t('画像は 2 MB 以下にしてください。', 'Use an image of 2 MB or less.'));
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    chooseIcon(() => setPicked({ bytes, url }));
  }
  async function save() {
    if (saving || textProblem || imageMissing || folderProblem || !name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const saved =
        kind === 'image' && picked
          ? { kind: 'image' as const, path: await host.saveSpaceIcon(space.scopeId, picked.bytes) }
          : icon;
      // The colour shown is written down; an untouched icon stays derived from the name.
      const look = { icon: saved, color };
      let next = await host.updateSpace(space.scopeId, {
        name: name.trim(),
        category: category === 'none' ? null : category,
        appearance: look,
        labels: {
          Knowledge_Base: labels.Knowledge_Base || null,
          contents: labels.contents || null,
        },
      });
      const renamed: (LayerFolderRename & { layer: NamedLayer })[] = [];
      for (const layer of namedLayers) {
        const folder = folders[layer].trim();
        if (folder === layerFolder(next, layer).split('/').at(-1)) continue;
        if (beforeRename && !(await beforeRename())) break;
        const result = await host.renameLayerFolder(space.scopeId, layer, folder);
        next = result.space;
        renamed.push({ ...result, layer });
      }
      onSaved(next, renamed);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setSaving(false);
    }
  }
  if (removing && onRemoved)
    return (
      <RemoveHibachi
        space={space}
        beforeRemove={beforeRename}
        onRemoved={onRemoved}
        onClose={() => setRemoving(false)}
      />
    );
  const glow = { '--glow': `var(--t-${color})` } as CSSProperties;
  const others = spaces.filter((item) => item.scopeId !== space.scopeId).slice(0, 3);
  return (
    <Dialog
      label={t('hibachi の設定', 'hibachi settings')}
      className="modal-dialog brain-sheet-dialog"
      busy={saving}
      onClose={onClose}
    >
      <form
        className="brain-sheet on-stage"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header className="brain-sheet-header">
          <BrainTile space={draft} image={image} size={26} radius={8} ring="stage" />
          <h2>{t('hibachi の設定', 'hibachi settings')}</h2>
          <button
            type="button"
            className="stage-button"
            aria-label={t('閉じる', 'Close')}
            disabled={saving}
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="brain-sheet-body">
          <section className="brain-sheet-identity">
            <div className="brain-sheet-hero" style={glow}>
              <BrainTile space={draft} image={image} size={112} radius={28} ring="stage" />
            </div>
            <div className="brain-sheet-fields">
              <label>
                {t('名前', 'Name')}
                <input
                  value={name}
                  maxLength={120}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <div className="brain-sheet-row">
                <span>{t('分類', 'Category')}</span>
                <Segments
                  label={t('分類', 'Category')}
                  name="brain-category"
                  value={category}
                  options={[
                    ...(['personal', 'team', 'organization'] as const).map((value) => ({
                      value,
                      label: categoryName(value),
                    })),
                    { value: 'none' as const, label: t('なし', 'None') },
                  ]}
                  onChange={setCategory}
                />
                <span className="brain-sheet-path mono" title={space.root}>
                  {space.root}
                </span>
              </div>
            </div>
          </section>
          <section className="brain-sheet-previews" aria-label={t('プレビュー', 'Preview')}>
            <div>
              <span>{t('レール', 'Rail')}</span>
              <div className="preview-rail">
                {others.slice(0, 1).map((item) => (
                  <BrainTile key={item.scopeId} space={item} size={32} radius={10} />
                ))}
                <BrainTile space={draft} image={image} size={32} radius={10} ring="active" />
                {others.slice(1).map((item) => (
                  <BrainTile key={item.scopeId} space={item} size={32} radius={10} />
                ))}
              </div>
            </div>
            <div>
              <span>{t('地図', 'Map')}</span>
              <div className="preview-map">
                <BrainTile space={draft} image={image} size={44} radius={13} />
                <strong>{draft.name}</strong>
              </div>
            </div>
            <div>
              <span>{t('ノート', 'Note')}</span>
              <div className="preview-note">
                <BrainTile space={draft} image={image} size={20} radius={6} ring="stage" />
                {draft.name}
                <Icon name="chevron" size={12} />
                <Icon name="book" size={14} />
                {layerLabel(draft, 'Knowledge_Base')}
              </div>
            </div>
          </section>
          <section className="brain-sheet-layers">
            <h3>{t('層', 'Layers')}</h3>
            <div className="brain-sheet-layer-grid">
              <span />
              <span className="brain-sheet-layer-head">{t('表示名', 'Shown as')}</span>
              <span className="brain-sheet-layer-head">{t('フォルダ', 'Folder')}</span>
              {namedLayers.map((layer) => (
                <div
                  key={layer}
                  className="brain-sheet-layer"
                  role="group"
                  aria-label={defaultLayerLabel(layer)}
                >
                  <Icon name={layerIcons[layer]} size={15} className={`layer-icon ${layer}`} />
                  <input
                    value={labels[layer]}
                    maxLength={40}
                    placeholder={defaultLayerLabel(layer)}
                    aria-label={t(
                      `${defaultLayerLabel(layer)} の表示名`,
                      `${defaultLayerLabel(layer)} shown as`,
                    )}
                    onChange={(event) =>
                      setLabels((value) => ({ ...value, [layer]: event.target.value }))
                    }
                  />
                  <input
                    className="mono"
                    value={folders[layer]}
                    maxLength={64}
                    aria-label={t(
                      `${defaultLayerLabel(layer)} のフォルダ`,
                      `${defaultLayerLabel(layer)} folder`,
                    )}
                    aria-invalid={!!folderProblems[layer]}
                    onChange={(event) =>
                      setFolders((value) => ({ ...value, [layer]: event.target.value }))
                    }
                  />
                  {folderProblems[layer] && <small role="alert">{folderProblems[layer]}</small>}
                </div>
              ))}
            </div>
          </section>
          <section className="brain-sheet-icons">
            <div className="brain-sheet-row">
              <h3>{t('アイコン', 'Icon')}</h3>
              <Segments
                label={t('アイコンの種類', 'Icon kind')}
                name="brain-icon-kind"
                value={kind}
                options={[
                  { value: 'glyph', label: t('記号', 'Symbol') },
                  { value: 'text', label: t('文字', 'Letters') },
                  { value: 'image', label: t('画像', 'Image') },
                ]}
                onChange={(value) => chooseIcon(() => setKind(value))}
              />
            </div>
            {kind === 'glyph' && (
              <fieldset className="glyph-grid">
                <legend className="sr-only">{t('記号', 'Symbol')}</legend>
                {brainGlyphs.map((value) => {
                  const Glyph = glyphs[value];
                  return (
                    <label key={value} data-checked={value === glyph} title={glyphName(value)}>
                      <input
                        type="radio"
                        name="brain-glyph"
                        value={value}
                        aria-label={glyphName(value)}
                        checked={value === glyph}
                        onChange={() => chooseIcon(() => setGlyph(value))}
                      />
                      <Glyph width={19} height={19} strokeWidth={1.8} aria-hidden="true" />
                    </label>
                  );
                })}
              </fieldset>
            )}
            {kind === 'text' && (
              <label className="brain-sheet-text">
                {t('表示する文字', 'Characters to show')}
                <input
                  value={text}
                  maxLength={16}
                  aria-invalid={!!textProblem}
                  onChange={(event) => chooseIcon(() => setText(event.target.value))}
                />
                {textProblem && <small role="alert">{textProblem}</small>}
              </label>
            )}
            {kind === 'image' && (
              <label className="brain-sheet-image">
                <span className="stage-text-button framed">
                  <Icon name="folder" size={15} />
                  {t('画像を選ぶ', 'Choose an image')}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  aria-label={t('アイコンの画像', 'Icon image')}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void pick(file).catch((error) => setError(errorText(error)));
                  }}
                />
                <small>
                  {t('PNG・JPEG・GIF・WebP、2 MB まで', 'PNG, JPEG, GIF or WebP, up to 2 MB')}
                </small>
              </label>
            )}
          </section>
          <section className="brain-sheet-colors">
            <h3>{t('色', 'Colour')}</h3>
            <fieldset className="swatches">
              <legend className="sr-only">{t('色', 'Colour')}</legend>
              {brainColors.map((value) => (
                <label key={value} data-checked={value === color}>
                  <input
                    type="radio"
                    name="brain-color"
                    value={value}
                    checked={value === color}
                    onChange={() => setColor(value)}
                  />
                  <span
                    className="swatch"
                    style={{ background: `var(--t-${value})`, color: `var(--t-${value}-fg)` }}
                  >
                    {value === color && <Icon name="check" size={15} strokeWidth={2.4} />}
                  </span>
                  {brainColorName(value)}
                </label>
              ))}
            </fieldset>
          </section>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="brain-sheet-footer">
          {onRemoved && (
            <button
              type="button"
              className="stage-text-button danger"
              disabled={saving}
              onClick={() => setRemoving(true)}
            >
              <Icon name="trash" size={14} />
              {t('hibachi を削除', 'Remove hibachi')}
            </button>
          )}
          <span className="brain-sheet-space" />
          <button type="button" className="stage-text-button" disabled={saving} onClick={onClose}>
            {t('キャンセル', 'Cancel')}
          </button>
          <button
            className="solid-button"
            disabled={saving || !!textProblem || imageMissing || folderProblem || !name.trim()}
          >
            <Icon name="check" size={14} />
            {saving ? t('保存中…', 'Saving…') : t('保存', 'Save')}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
