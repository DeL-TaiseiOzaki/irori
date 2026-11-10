import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { Icon, type IconName } from './Icon';
import { BrainTile } from './BrainTile';
import { UpdateNotice, updateWaiting, useUpdateState } from './UpdateNotice';
import { AccountSection, RestoreEnvironment } from './AccountSync';
import { IroriAgentFolderSection } from './IroriAgentFolder';
import { appVersion } from './branding';
import { ErrorMessage } from './ErrorMessage';
import { useAction } from './useAction';
import { useChoice } from './useChoice';
import { useLanguage } from './useLanguage';
import { useResource } from './useResource';
import { useWindowItems } from './useWindowItems';
import {
  chooseLanguage,
  chooseLineSpacing,
  chooseMarkdownFont,
  choosePageMargins,
  chooseTextSize,
  chooseRoutineRuntimes,
  chooseTheme,
  chooseWindowItems,
  currentLanguageChoice,
  currentLineSpacing,
  currentMarkdownFont,
  currentPageMargins,
  currentTextSize,
  currentRoutineRuntimes,
  currentTheme,
} from './device-settings';
import {
  agentAccessModes,
  agentNames,
  lineSpacings,
  markdownFonts,
  pageMargins,
  textSizes,
  themes,
  type AgentAccess,
  type LineSpacing,
  type MarkdownFont,
  type PageMargins,
  type Space,
  type TextSize,
  type Theme,
} from '../domain/types';
import { sharedSchemaId, type YourAi } from '../domain/you';
import { environmentRepository } from '../domain/environment';
import { languages, t, type Language } from '../domain/i18n';
import type { RoutineRuntime } from '../domain/routines';
import {
  everyWindowItem,
  windowItemAreas,
  windowItemDefaults,
  windowItems,
  type WindowItem,
  type WindowItemArea,
} from '../domain/window-items';

const host = window.irori;

// Labels are functions so that they are read in the language of each render.
const themeLabels: Record<Theme, () => string> = {
  system: () => t('システムに合わせる', 'Match system'),
  hearth: () => t('いろり', 'Hearth'),
  light: () => t('ライト', 'Light'),
  dark: () => t('ダーク', 'Dark'),
};

/** What a theme's choice shows; its name stays the full label, kept as its tooltip. */
const themeChoiceLabels: Partial<Record<Theme, () => string>> = {
  system: () => t('システム', 'Match system'),
};

/** What the chosen theme looks like, under the themes. */
const themeNotes: Record<Theme, () => string> = {
  system: () =>
    t(
      'OS の外観に合わせて、明るいときは「いろり」、暗いときは「ダーク」になります。',
      'Follows the system: Hearth while it is light, Dark while it is dark.',
    ),
  hearth: () =>
    t(
      'まわりはグラファイト、ノートは紙の色です。',
      'Graphite around the note, paper for the note itself.',
    ),
  light: () => t('まわりもノートも紙の色です。', 'Paper throughout.'),
  dark: () => t('まわりもノートもグラファイトです。', 'Graphite throughout.'),
};

const fontLabels: Record<MarkdownFont, () => string> = {
  system: () => t('システム', 'System'),
  sans: () => t('ゴシック', 'Sans-serif'),
  rounded: () => t('丸ゴシック', 'Rounded'),
  serif: () => t('明朝', 'Serif'),
  textbook: () => t('教科書体', 'Textbook'),
  mono: () => t('等幅', 'Monospace'),
};

const marginLabels: Record<PageMargins, () => string> = {
  standard: () => t('標準', 'Standard'),
  small: () => t('小', 'Small'),
  minimal: () => t('最小', 'Minimal'),
};

/** What the chosen side margins do, under them; the widths are `style.css`'s `--page-width`. */
const marginNotes: Record<PageMargins, () => string> = {
  standard: () =>
    t('本文を読みやすい幅（696px）に収めます。', 'Keeps the text to a reading width (696 px).'),
  small: () =>
    t('本文を広め（1000px まで）に使います。', 'Lets the text run wider, up to 1000 px.'),
  minimal: () => t('本文をノートの幅いっぱいに広げます。', 'Lets the text fill the whole page.'),
};

const sizeLabels: Record<TextSize, () => string> = {
  small: () => t('小', 'Small'),
  standard: () => t('標準', 'Standard'),
  large: () => t('大', 'Large'),
  larger: () => t('特大', 'Larger'),
};

/** A note's text size in pixels, as `style.css` sets `--markdown-size` for each. */
const sizePixels: Record<TextSize, number> = { small: 14, standard: 16, large: 18, larger: 20 };

const spacingLabels: Record<LineSpacing, () => string> = {
  compact: () => t('詰める', 'Compact'),
  standard: () => t('標準', 'Standard'),
  relaxed: () => t('広い', 'Relaxed'),
};

const accessLabels: Record<AgentAccess, () => string> = {
  default: () => t('標準（CLI の承認に従う）', "Standard (the CLI's approvals)"),
  'full-access': () => t('フルアクセス', 'Full access'),
};

const accessChoiceLabels: Record<AgentAccess, () => string> = {
  default: () => t('標準', 'Standard'),
  'full-access': () => t('フルアクセス', 'Full access'),
};

const accessDetails: Record<AgentAccess, () => string> = {
  default: () => t('各 CLI の承認に従います。', "Follows each CLI's approvals."),
  'full-access': () =>
    t(
      '承認を求めずにコマンドを実行し、ファイルを変更します。',
      'Runs commands and changes files without asking.',
    ),
};

/** Where on the window each group of optional controls appears (ADR 059). */
const windowAreaLabels: Record<WindowItemArea, () => string> = {
  composer: () => t('エージェントへの指示の入力欄', 'Under the instruction box'),
  conversation: () => t('会話の上部', "At the top of an agent's column"),
  status: () => t('ステータスバー（ウィンドウの下端）', "The status bar, along the window's foot"),
};

const windowItemLabels: Record<WindowItem, () => string> = {
  access: () => t('アクセス', 'Access'),
  model: () => t('モデルと思考量', 'Model and thinking level'),
  skill: () => t('スキル', 'Skill'),
  personLines: () => t('人の行を伝える', "Share the person's lines"),
  columns: () => t('列の操作', 'Columns'),
  branch: () => t('ブランチ', 'Branch'),
  terminal: () => t('ターミナル', 'Terminal'),
  version: () => t('バージョン', 'Version'),
};

/** What turning an item on puts on the window, and what holds while it is off. */
const windowItemNotes: Record<WindowItem, () => string> = {
  access: () =>
    t(
      '入力欄の会話の設定メニューで、その会話が承認なしでどこまで動けるかを切り替えられます。オフのあいだ、新しい会話は「エージェント → 共通」で選んだアクセスで始まります。フルアクセスの会話では、オフでも表示されます。',
      "Lets the conversation's menu under the instruction box change how far it may act without asking. Off, a new conversation starts in the access chosen under Agents → Shared. A conversation in full access shows it even when this is off.",
    ),
  model: () =>
    t(
      '入力欄の会話の設定メニューで、使うモデルと思考量を選べます。オフのあいだは、最後に選んだもの（選んでいなければ CLI の既定）で動きます。',
      "Lets the conversation's menu under the instruction box choose its model and thinking level. Off, it runs with the last choice, or the CLI's default where none was made.",
    ),
  skill: () =>
    t(
      'その依頼で使うスキルを、入力欄で選べます。スキルのある vault の vault agent に出ます。オフのあいだ、依頼にスキルは添えられません。',
      'Lets a request name the skill it uses; shown for the vault agent of a vault that has skills. Off, no skill goes with a request.',
    ),
  personLines: () =>
    t(
      '人が書いた行のあるノートを開いているとき、その行をエージェントに伝えるかを入力欄で選べます。オフのあいだは伝えません。',
      'With a note that has lines a person wrote, lets a request tell the agent which they are. Off, they are not told.',
    ),
  columns: () =>
    t(
      '会話の列を増やすボタンと、本文を隠すボタンを出します。本文を隠しているあいだは、オフでも戻すボタンが表示されます。',
      'Shows the buttons that add a column and hide the page. While the page is hidden, the button that shows it stays even when this is off.',
    ),
  branch: () =>
    t(
      '開いている vault の Git ブランチと、まだ送っていない・受け取っていないコミットの数を出します。',
      'Shows the Git branch of the vault on show, and how many commits wait to be pushed or pulled.',
    ),
  terminal: () =>
    t(
      'ターミナルを開くボタンを、ステータスバーと vault のホームに出します。オフでも Ctrl+` で開閉でき、開いているあいだはボタンが表示されます。',
      "Shows the button that opens the terminal, in the status bar and on a vault's home. Off, Ctrl+` still opens and closes it, and the button stays while it is open.",
    ),
  version: () =>
    t(
      'irori のバージョンを出します。「アカウントと更新 → 更新」でも確かめられます。',
      "Shows irori's version, which Account and updates → Updates names too.",
    ),
};

// Each language is named in itself, so it can be found whichever is showing.
const languageLabels: Record<Language, string> = { ja: '日本語', en: 'English' };

/** The groups of the side list, each a frame of its own. */
const groups = [
  { id: 'display', label: () => t('表示', 'Display') },
  { id: 'agents', label: () => t('エージェント', 'Agents') },
  { id: 'automation', label: () => t('自動化', 'Automation') },
  { id: 'account', label: () => t('アカウントと更新', 'Account and updates') },
] as const;

/** The settings' parts, in the order the side lists them; one shows at a time. */
const parts = [
  {
    id: 'general',
    group: 'display',
    icon: 'appearance',
    label: () => t('言語とテーマ', 'Language and theme'),
  },
  { id: 'notes', group: 'display', icon: 'file', label: () => t('ノートの表示', 'Notes') },
  {
    id: 'window',
    group: 'display',
    icon: 'columns',
    label: () => t('画面に出すもの', 'What the window shows'),
  },
  { id: 'agents', group: 'agents', icon: 'users', label: () => t('共通', 'Shared') },
  { id: 'irori-agent', group: 'agents', icon: 'agent', label: () => 'irori agent' },
  { id: 'vault-agent', group: 'agents', icon: 'layers', label: () => 'vault agent' },
  {
    id: 'routines',
    group: 'automation',
    icon: 'routine',
    label: () => t('ルーティン', 'Routines'),
  },
  { id: 'account', group: 'account', icon: 'user', label: () => t('アカウント', 'Account') },
  { id: 'updates', group: 'account', icon: 'refresh', label: () => t('更新', 'Updates') },
] as const satisfies readonly {
  id: string;
  group: (typeof groups)[number]['id'];
  icon: IconName;
  label: () => string;
}[];
type Part = (typeof parts)[number];
type PartId = Part['id'];

/** The part on show when the settings last closed, shown again when they next open. */
let lastPart: PartId = 'general';

/** What a part's entry in the side list says of it: its current value, or what it is for. */
type Summary = { text: string; attention?: boolean; badge?: boolean };

/** What a workspace adds to the settings; the start screen has none. */
export type SettingsWorkspace = {
  id: string;
  /** The irori agent; its Schema and the shared one need it set up (ADR 027). */
  you?: YourAi;
  /** The workspace's vaults, whose Schema the vault agent page opens. */
  vaults: readonly Space[];
  /** Opens the Schema dialog on one owner: the shared Schema, the irori agent's or a vault's. */
  onSchema: (owner: string) => void;
  /** Shows the irori agent's own screen. */
  onIroriAgent: () => void;
  /** Sets the irori agent up in its folder: its starter files and standard skills (ADR 025). */
  onCreateIroriAgent: () => Promise<void>;
  /** The irori agent's folder for this workspace changed (ADR 044). */
  onFolderChanged: () => void;
};

/**
 * One choice among a few, each option a tile marked when chosen. The radio keeps
 * the option's full name whatever the tile shows.
 */
function Choices<T extends string>({
  legend,
  description,
  name,
  value,
  options,
  label,
  shown = label,
  render,
  hint,
  detail,
  tone,
  columns = Math.min(options.length, 4),
  children,
  onChange,
}: {
  legend: string;
  /** What the choice changes, under its name. */
  description?: ReactNode;
  name: string;
  value: T;
  options: readonly T[];
  label: (option: T) => string;
  /** A shorter text to show where the label does not fit; the label stays its name. */
  shown?: (option: T) => string;
  render?: (option: T) => ReactNode;
  /** A short measure at the tile's end, such as a size in pixels. */
  hint?: (option: T) => string;
  /** A line under the option's name saying what it does. */
  detail?: (option: T) => string;
  /** An option that lets agents act without asking takes the attention role (ADR 053). */
  tone?: (option: T) => 'attention' | undefined;
  columns?: number;
  /** A note under the tiles, about the option chosen. */
  children?: ReactNode;
  onChange: (option: T) => void;
}) {
  const id = useId();
  return (
    <div className="settings-item">
      <fieldset className={`settings-choices ${name}`}>
        <legend>{legend}</legend>
        {description && <p className="settings-description">{description}</p>}
        <div className="settings-tiles" style={{ '--columns': columns } as CSSProperties}>
          {options.map((option) => {
            const checked = value === option;
            const full = label(option);
            const text = shown(option);
            const line = detail?.(option);
            return (
              <label
                key={option}
                className="settings-tile"
                data-checked={checked}
                data-tone={tone?.(option)}
                title={text === full ? undefined : full}
              >
                <input
                  type="radio"
                  name={name}
                  value={option}
                  checked={checked}
                  aria-label={full}
                  aria-describedby={line ? `${id}${option}` : undefined}
                  onChange={() => onChange(option)}
                />
                {render?.(option)}
                <span className="settings-tile-text">
                  <span className="settings-tile-label">{text}</span>
                  {line && <small id={`${id}${option}`}>{line}</small>}
                </span>
                {hint && (
                  <span className="settings-tile-hint" aria-hidden="true">
                    {hint(option)}
                  </span>
                )}
                <Icon name="check" size={14} className="settings-tile-check" />
              </label>
            );
          })}
        </div>
        {children}
      </fieldset>
    </div>
  );
}

/** A setting that is on or off, as a switch that says which. */
function SwitchRow({
  label,
  description,
  checked,
  busy = false,
  children,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  /** The change is still being made; the switch waits for it. */
  busy?: boolean;
  /** Shown under the description, such as the progress of a change. */
  children?: ReactNode;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="settings-item settings-row">
      <div className="settings-row-text">
        <label className="settings-row-label" htmlFor={id}>
          {label}
        </label>
        {description && (
          <p className="settings-description" id={`${id}-description`}>
            {description}
          </p>
        )}
        {children}
      </div>
      <span className="settings-switch-state" aria-hidden="true">
        {checked ? t('オン', 'On') : t('オフ', 'Off')}
      </span>
      <span className="settings-switch">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={busy}
          aria-describedby={description ? `${id}-description` : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span aria-hidden="true" />
      </span>
    </div>
  );
}

/** A setting kept somewhere else: what it is, and the button that goes there. */
function Row({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="settings-item settings-row">
      <div className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {description && <p className="settings-description">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** Opens a view of its own; the chevron says it leaves the settings. */
function OpenButton({
  name,
  disabled,
  onClick,
}: {
  /** The button's name where its text alone would not say what it opens. */
  name?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="settings-open"
      aria-label={name}
      disabled={disabled}
      onClick={onClick}
    >
      {t('開く', 'Open')}
      <Icon name="chevron" size={14} />
    </button>
  );
}

/** Where a row's button would be, when the setting needs a workspace or a setup first. */
function Aside({ children }: { children: ReactNode }) {
  return <span className="settings-row-aside">{children}</span>;
}

/** Rows that belong together, framed, with an optional heading above the frame. */
function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="settings-block">
      {title && <h4>{title}</h4>}
      <div className="settings-group">{children}</div>
    </div>
  );
}

/** One part of the settings: its name, what it governs, and its groups. */
function Page({ part, lead, children }: { part: Part; lead: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-page">
      <header className="settings-page-head">
        <h3>
          <Icon name={part.icon} size={18} />
          {part.label()}
        </h3>
        <p>{lead}</p>
      </header>
      {children}
    </div>
  );
}

/**
 * A few lines in the note's own face, size, spacing and side margins, which the
 * root's attributes set as they do for every note, so a choice shows at once.
 */
function NotePreview() {
  return (
    <figure className="settings-preview" aria-label={t('ノートの見本', 'A sample note')}>
      <div className="settings-preview-page">
        <p className="settings-preview-title">{t('ノートの見本', 'A sample note')}</p>
        <p>
          {t(
            'ノートの本文はこのように表示されます。フォント・文字の大きさ・行間・左右の余白を選ぶと、ここにすぐ反映されます。',
            'This is how the text of a note reads. Choose a font, a text size, a line spacing or side margins and it shows here at once.',
          )}
        </p>
      </div>
    </figure>
  );
}

/** Changes of a runtime still under way, kept while the settings close and open again. */
const runtimeChanges = new Map<RoutineRuntime, Promise<boolean>>();

/**
 * Whether routines may use one runtime on this device (ADR 016 D3). Python
 * downloads uv first, which takes a while; turning it off keeps the download.
 * Read again whenever the settings open, since a routine's row can add one too.
 */
function useRuntime(name: RoutineRuntime, onError: (error: unknown) => void) {
  const [on, setOn] = useState(() => currentRoutineRuntimes().includes(name));
  const [busy, setBusy] = useState(() => runtimeChanges.has(name));
  const alive = useRef(true);
  const follow = (change: Promise<boolean>) =>
    void change.then((value) => {
      if (!alive.current) return;
      setOn(value);
      setBusy(false);
    });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const read = () => {
    const change = runtimeChanges.get(name);
    setBusy(!!change);
    if (change) follow(change);
    else setOn(currentRoutineRuntimes().includes(name));
  };
  const choose = (next: boolean) => {
    setOn(next);
    setBusy(true);
    const change = (async () => {
      if (next && name === 'python') await host.installPython();
      const others = currentRoutineRuntimes().filter((item) => item !== name);
      await chooseRoutineRuntimes(next ? [...others, name] : others);
      return next;
    })()
      .catch((error: unknown) => {
        onError(error);
        return !next;
      })
      .finally(() => runtimeChanges.delete(name));
    runtimeChanges.set(name, change);
    follow(change);
  };
  return { on, busy, choose, read };
}

/**
 * The startup screen has no rail, so the language is offered there on its own:
 * one button naming the other language in that language, which a reader who
 * cannot read the current one can still find.
 */
export function LanguageSwitch({ onError }: { onError: (error: unknown) => void }) {
  const [language, choose] = useChoice<Language>(currentLanguageChoice, chooseLanguage, onError);
  const other = languages.find((option) => option !== language) ?? 'ja';
  return (
    <button type="button" className="language-switch" lang={other} onClick={() => choose(other)}>
      <Icon name="language" size={14} />
      {languageLabels[other]}
    </button>
  );
}

/**
 * The settings (ADR 057): the side lists their parts in framed groups — the
 * display, the agents (what applies to all of them, the irori agent and the
 * vault agents), routines, and the account with updates — each with its current
 * value, and the part chosen shows beside it. The rail opens them in a
 * workspace; the start screen opens them before any workspace is, without what
 * needs one.
 */
export function Settings({
  start = false,
  vaultAgent,
  onVaultAgent,
  agentAccess,
  onAgentAccess,
  onRestored,
  workspace,
  onError,
}: {
  /** Opened from the start screen, whose footer already offers updates. */
  start?: boolean;
  /** Each vault's own agent and its Schema layer are offered (ADR 021). */
  vaultAgent: boolean;
  onVaultAgent: (on: boolean) => void;
  /** The access every agent's new conversation starts in (ADR 009). */
  agentAccess: AgentAccess;
  onAgentAccess: (access: AgentAccess) => void;
  /** The environment saved on the account was restored here (ADR 026). */
  onRestored: () => Promise<void>;
  /** The workspace open in this window, with what only it can offer. */
  workspace?: SettingsWorkspace;
  onError: (error: unknown) => void;
}) {
  const updates = useUpdateState(host);
  const [open, setOpen] = useState(false),
    [restoring, setRestoring] = useState(false);
  const shownParts = parts.filter((part) => !(start && part.id === 'updates'));
  const [part, setPart] = useState<PartId>(lastPart);
  // Each CLI's version, asked for while the part that lists them is on show.
  const clis = useResource(() => host.agents(), [], { enabled: open && part === 'agents' });
  const [theme, chooseThemeValue] = useChoice(currentTheme, chooseTheme, onError);
  const [font, chooseFont] = useChoice(currentMarkdownFont, chooseMarkdownFont, onError);
  const [margins, chooseMargins] = useChoice(currentPageMargins, choosePageMargins, onError);
  const [size, chooseSize] = useChoice(currentTextSize, chooseTextSize, onError);
  const [spacing, chooseSpacing] = useChoice(currentLineSpacing, chooseLineSpacing, onError);
  const [language, chooseLanguageValue, setLanguage] = useChoice<Language>(
    currentLanguageChoice,
    chooseLanguage,
    onError,
  );
  const setup = useAction();
  // The window's optional controls (ADR 059); a choice shows on the window at once.
  const items = useWindowItems();
  const chooseItems = (choices: Parameters<typeof chooseWindowItems>[0]) =>
    void chooseWindowItems(choices).catch(onError);
  const itemsShown = windowItems.filter((item) => items[item]).length;
  const javascript = useRuntime('javascript', onError);
  const python = useRuntime('python', onError);
  // The start screen's language switch changes the language beside these settings.
  const shown = useLanguage();
  useEffect(() => setLanguage(shown), [shown]);
  const label = t(
    `設定（テーマ：${themeLabels[theme]()}、Markdown：${fontLabels[font]()}、言語：${languageLabels[language]}）`,
    `Settings (theme: ${themeLabels[theme]()}, Markdown: ${fontLabels[font]()}, language: ${languageLabels[language]})`,
  );
  const show = () => {
    javascript.read();
    python.read();
    setPart(shownParts.some((item) => item.id === lastPart) ? lastPart : shownParts[0].id);
    setOpen(true);
  };
  const close = () => setOpen(false);
  const choosePart = (id: PartId) => {
    lastPart = id;
    setPart(id);
  };
  const you = workspace?.you?.state === 'ready' ? workspace.you : undefined;
  const openSchema = (owner: string) => {
    close();
    workspace?.onSchema(owner);
  };
  const waiting = updateWaiting(updates);
  const list = t('・', ', ');
  const summary = (id: PartId): Summary => {
    switch (id) {
      case 'general':
        return {
          text: `${languageLabels[language]}${list}${(themeChoiceLabels[theme] ?? themeLabels[theme])()}`,
        };
      case 'notes':
        return { text: `${fontLabels[font]()}${list}${sizePixels[size]}px` };
      case 'window':
        return {
          text: itemsShown
            ? t(
                `表示中 ${itemsShown} / ${windowItems.length}`,
                `${itemsShown} of ${windowItems.length} shown`,
              )
            : t('すべてオフ', 'All off'),
        };
      case 'agents':
        return {
          text: t(
            `新しい会話：${accessChoiceLabels[agentAccess]()}`,
            `New conversations: ${accessChoiceLabels[agentAccess]()}`,
          ),
          attention: agentAccess === 'full-access',
        };
      case 'irori-agent':
        return { text: t('ワークスペース全体を担当', 'Works across the workspace') };
      case 'vault-agent':
        return { text: vaultAgent ? t('オン', 'On') : t('オフ', 'Off') };
      case 'routines':
        return {
          text:
            [javascript.on && 'JavaScript', python.on && 'Python'].filter(Boolean).join(list) ||
            t('実行環境なし', 'No runtimes'),
        };
      case 'account':
        return { text: t('GitHub に環境を保存', 'Environment on GitHub') };
      case 'updates':
        return {
          text: waiting ? `${appVersion}${list}${t('更新あり', 'Update available')}` : appVersion,
          badge: waiting,
        };
    }
  };
  const needsWorkspace = (
    <Aside>{t('ワークスペースを開くと設定できます', 'Set in a workspace')}</Aside>
  );
  const pages: Record<PartId, () => ReactNode> = {
    general: () => (
      <Group>
        <Choices
          legend={t('言語', 'Language')}
          name="language"
          value={language}
          options={languages}
          label={(option) => languageLabels[option]}
          onChange={chooseLanguageValue}
        />
        <Choices
          legend={t('テーマ', 'Theme')}
          name="theme"
          value={theme}
          options={themes}
          label={(option) => themeLabels[option]()}
          shown={(option) => (themeChoiceLabels[option] ?? themeLabels[option])()}
          render={(option) => <Icon name={option} size={15} />}
          onChange={chooseThemeValue}
        >
          <p className="settings-note">{themeNotes[theme]()}</p>
        </Choices>
      </Group>
    ),
    notes: () => (
      <>
        <div className="settings-preview-stick">
          <NotePreview />
        </div>
        <Group>
          <Choices
            legend={t('Markdown フォント', 'Markdown font')}
            name="markdown-font"
            value={font}
            options={markdownFonts}
            columns={3}
            label={(option) => fontLabels[option]()}
            render={(option) => (
              <span className={`font-swatch font-${option}`} aria-hidden="true">
                文
              </span>
            )}
            onChange={chooseFont}
          />
          <Choices
            legend={t('文字の大きさ', 'Text size')}
            name="text-size"
            value={size}
            options={textSizes}
            label={(option) => sizeLabels[option]()}
            hint={(option) => `${sizePixels[option]}px`}
            onChange={chooseSize}
          />
          <Choices
            legend={t('行間', 'Line spacing')}
            name="line-spacing"
            value={spacing}
            options={lineSpacings}
            label={(option) => spacingLabels[option]()}
            onChange={chooseSpacing}
          />
          <Choices
            legend={t('左右の余白', 'Side margins')}
            name="page-margins"
            value={margins}
            options={pageMargins}
            label={(option) => marginLabels[option]()}
            onChange={chooseMargins}
          >
            <p className="settings-note">{marginNotes[margins]()}</p>
          </Choices>
        </Group>
      </>
    ),
    window: () => (
      <>
        <Group>
          <Row
            label={t('まとめて切り替える', 'All at once')}
            description={t(
              '既定では、設定や開発向けの項目を画面に出しません。',
              'By default the window leaves out settings and developer tools.',
            )}
          >
            <span className="settings-row-actions">
              <button
                type="button"
                className="settings-action"
                disabled={windowItems.every((item) => items[item] === windowItemDefaults[item])}
                onClick={() => chooseItems(windowItemDefaults)}
              >
                {t('既定に戻す', 'Back to default')}
              </button>
              <button
                type="button"
                className="settings-action"
                disabled={itemsShown === windowItems.length}
                onClick={() => chooseItems(everyWindowItem(true))}
              >
                {t('すべて出す', 'Show all')}
              </button>
            </span>
          </Row>
        </Group>
        {windowItemAreas.map((area) => (
          <Group key={area.id} title={windowAreaLabels[area.id]()}>
            {area.items.map((item) => (
              <SwitchRow
                key={item}
                label={windowItemLabels[item]()}
                description={windowItemNotes[item]()}
                checked={items[item]}
                onChange={(on) => chooseItems({ [item]: on })}
              />
            ))}
          </Group>
        ))}
      </>
    ),
    agents: () => (
      <>
        <Group>
          <Choices
            legend={t('新しい会話のアクセス', 'Access of a new conversation')}
            description={t(
              '新しく始める会話が、承認なしでどこまで動けるかを選びます。',
              'How far a new conversation may act without asking.',
            )}
            name="agent-access"
            value={agentAccess}
            options={agentAccessModes}
            label={(option) => accessLabels[option]()}
            shown={(option) => accessChoiceLabels[option]()}
            detail={(option) => accessDetails[option]()}
            tone={(option) => (option === 'full-access' ? 'attention' : undefined)}
            onChange={onAgentAccess}
          >
            <p className={`settings-note ${agentAccess === 'full-access' ? 'attention' : ''}`}>
              {agentAccess === 'full-access'
                ? t(
                    'irori agent と vault agent の新しい会話は、すべてフルアクセスで始まります。エージェントは承認を求めずにコマンドを実行してファイルを変更し、あなたのユーザーで届く範囲すべてに届きます。会話ごとに標準へ切り替えられます。今ある会話のアクセスは変わりません。',
                    'Every new conversation of the irori agent and the vault agents starts in full access: agents run commands and change files without asking, and reach anything your user account can. Each conversation can be switched back to standard. Existing conversations keep their access.',
                  )
                : t(
                    '新しい会話は標準で始まり、各 CLI の承認に従います。フルアクセスは会話ごとに選べます。今ある会話のアクセスは変わりません。',
                    "New conversations start in standard access, following each CLI's approvals. Full access can be chosen per conversation. Existing conversations keep their access.",
                  )}
            </p>
          </Choices>
        </Group>
        <Group>
          <Row
            label={t('共通 Schema', 'Shared Schema')}
            description={t(
              'すべてのエージェントが従う指示とスキルです。irori agent や vault の Schema が同じことを決めていれば、そちらが優先されます。',
              "Instructions and skills every agent follows. Where the irori agent's or a vault's own Schema says otherwise, its own wins.",
            )}
          >
            {!workspace ? (
              needsWorkspace
            ) : you ? (
              <OpenButton
                name={t('共通 Schema を開く', 'Open the shared Schema')}
                onClick={() => openSchema(sharedSchemaId)}
              />
            ) : (
              <Aside>{t('irori agent の用意が必要です', 'Needs the irori agent')}</Aside>
            )}
          </Row>
        </Group>
        <Group title={t('この端末の CLI', 'CLIs on this device')}>
          {clis.data ? (
            clis.data.map((cli) => (
              <Row
                key={cli.id}
                label={agentNames[cli.id]}
                description={
                  cli.available ? (
                    <span className="mono">{cli.version}</span>
                  ) : (
                    t(
                      '見つかりません。インストールとログインを確認してください。',
                      'Not found. Check that it is installed and signed in.',
                    )
                  )
                }
              >
                <Aside>{cli.available ? t('使えます', 'Ready') : t('未検出', 'Not found')}</Aside>
              </Row>
            ))
          ) : (
            <p className="settings-item settings-empty" role="status">
              {clis.error
                ? t('CLI を確認できませんでした。', 'Could not check the CLIs.')
                : t('CLI を確認中…', 'Checking the CLIs…')}
            </p>
          )}
        </Group>
      </>
    ),
    'irori-agent': () => (
      <Group>
        <div className="settings-item settings-folder">
          <div className="settings-row-text">
            <span className="settings-row-label">{t('作業フォルダ', 'Working folder')}</span>
            <p className="settings-description">
              {t(
                'このワークスペースで irori agent が作業するフォルダです。選ばなければ既定のフォルダを使います。',
                'Where the irori agent works for this workspace. Without a choice, it uses the default folder.',
              )}
            </p>
          </div>
          {workspace ? (
            <IroriAgentFolderSection
              workspaceId={workspace.id}
              onChanged={workspace.onFolderChanged}
            />
          ) : (
            needsWorkspace
          )}
        </div>
        {workspace?.you?.state === 'missing' && (
          <div className="settings-item settings-folder">
            <div className="settings-row settings-row-flat">
              <div className="settings-row-text">
                <span className="settings-row-label">
                  {t('irori agent を用意する', 'Set up the irori agent')}
                </span>
                <p className="settings-description">
                  {t(
                    '作業フォルダに irori agent の指示ファイルと標準スキルを作ります。Schema はそのあと設定できます。',
                    'Writes its instruction file and standard skills into the working folder; its Schema can be set after that.',
                  )}
                </p>
              </div>
              <button
                type="button"
                className="settings-open"
                disabled={setup.busy}
                onClick={() => void setup.run(workspace.onCreateIroriAgent)}
              >
                {setup.busy ? t('用意しています…', 'Setting up…') : t('用意する', 'Set up')}
              </button>
            </div>
            {setup.error && <ErrorMessage text={setup.error} />}
          </div>
        )}
        <Row
          label="Schema"
          description={t(
            'irori agent だけが従う指示とスキルです。すべてのエージェントに向けたものは「共通」で設定します。',
            'Instructions and skills only the irori agent follows. Those for every agent are set under Shared.',
          )}
        >
          {!workspace ? (
            needsWorkspace
          ) : you ? (
            <OpenButton
              name={t('irori agent の Schema を開く', "Open the irori agent's Schema")}
              onClick={() => openSchema(you.id)}
            />
          ) : (
            <Aside>{t('irori agent の用意が必要です', 'Needs the irori agent')}</Aside>
          )}
        </Row>
        {workspace && you && (
          <Row
            label={t('irori agent の画面', "The irori agent's screen")}
            description={t(
              'フォルダのファイルと Schema をまとめて見られます。',
              'Shows its folder as files beside its Schema.',
            )}
          >
            <OpenButton
              name={t('irori agent の画面を開く', "Open the irori agent's screen")}
              onClick={() => {
                close();
                workspace.onIroriAgent();
              }}
            />
          </Row>
        )}
      </Group>
    ),
    'vault-agent': () => (
      <>
        <Group>
          <SwitchRow
            label={t('vault agent を使う', 'Use vault agents')}
            description={t(
              'オンにすると、vault agent の列と各 vault の Schema が表示されます。',
              "On, the vault agents' columns and each vault's Schema show.",
            )}
            checked={vaultAgent}
            onChange={onVaultAgent}
          />
          <div className="settings-item">
            <p className="settings-note">
              {t(
                'オフでも、irori agent からの依頼とルーティンは、vault の中でその vault のエージェント設定を使って CLI を実行します。',
                "Off, hand-offs from the irori agent and routines still run a CLI inside a vault, with that vault's agent configuration.",
              )}
            </p>
          </div>
        </Group>
        <Group title={t('各 vault の Schema', "Each vault's Schema")}>
          {!workspace ? (
            <Row
              label={t('vault ごとの指示とスキル', 'Instructions and skills per vault')}
              description={t(
                'それぞれの vault agent が従う指示とスキルです。',
                'What each vault agent follows.',
              )}
            >
              {needsWorkspace}
            </Row>
          ) : !vaultAgent ? (
            <p className="settings-item settings-empty">
              {t(
                'vault agent をオンにすると、ここから各 vault の Schema を開けます。',
                "Turn vault agents on to open each vault's Schema here.",
              )}
            </p>
          ) : workspace.vaults.length === 0 ? (
            <p className="settings-item settings-empty">
              {t('このワークスペースに vault はありません。', 'This workspace has no vaults.')}
            </p>
          ) : (
            workspace.vaults.map((vault) => (
              <Row
                key={vault.scopeId}
                label={
                  <span className="settings-vault">
                    <BrainTile space={vault} size={20} radius={6} />
                    <span>{vault.name}</span>
                  </span>
                }
              >
                <OpenButton
                  name={t(`${vault.name} の Schema を開く`, `Open the Schema of ${vault.name}`)}
                  onClick={() => openSchema(vault.scopeId)}
                />
              </Row>
            ))
          )}
        </Group>
      </>
    ),
    routines: () => (
      <Group>
        <SwitchRow
          label="JavaScript"
          description={t(
            '.js・.mjs・.cjs のファイルを、irori 自身を Node として実行します。ダウンロードはありません。',
            'Runs .js, .mjs and .cjs files with irori itself as Node. Nothing is downloaded.',
          )}
          checked={javascript.on}
          busy={javascript.busy}
          onChange={javascript.choose}
        />
        <SwitchRow
          label="Python"
          description={t(
            '.py のファイルを uv で実行します。オンにすると uv を irori のデータフォルダにダウンロードします。オフにしてもダウンロードしたものは残ります。',
            "Runs .py files through uv. Turning it on downloads uv into irori's data folder; turning it off keeps the download.",
          )}
          checked={python.on}
          busy={python.busy}
          onChange={python.choose}
        >
          {python.busy && python.on && (
            <p className="settings-progress" role="status">
              <Icon name="loader" size={13} />
              {t('uv をダウンロードして準備しています…', 'Downloading and preparing uv…')}
            </p>
          )}
        </SwitchRow>
      </Group>
    ),
    account: () => (
      <Group>
        <div className="settings-item">
          <AccountSection
            heading={false}
            onRestore={() => {
              close();
              setRestoring(true);
            }}
          />
        </div>
      </Group>
    ),
    updates: () => (
      <Group>
        <section className="settings-item settings-updates" aria-label={t('更新', 'Updates')}>
          <UpdateNotice host={host} />
        </section>
      </Group>
    ),
  };
  const leads: Record<PartId, () => string> = {
    general: () =>
      t(
        'この端末のすべてのワークスペースで使われます。',
        'Used by every workspace on this device.',
      ),
    notes: () =>
      t(
        'ノート（Markdown）の文字と幅です。選ぶとすぐに反映され、見本で確かめられます。',
        "A note's type and width. A choice applies at once; the sample shows it.",
      ),
    window: () =>
      t(
        '画面には、ノートと会話に使うものだけを出しています。ここでオンにした項目が画面に加わり、選ぶとすぐに反映されます。',
        'The window shows what a note and a conversation need. An item turned on here joins it at once.',
      ),
    agents: () =>
      t(
        'irori agent と vault agent のどちらにも使われる設定です。',
        'What applies to the irori agent and the vault agents alike.',
      ),
    'irori-agent': () =>
      t(
        'ワークスペース全体を受け持つエージェントです。vault を用意し、それぞれの vault の作業はその vault のエージェントに任せます。',
        "The agent for the whole workspace. It sets up vaults and hands each vault's work to that vault's agent.",
      ),
    'vault-agent': () =>
      t(
        'それぞれの vault の中で、その vault の Schema に従って働くエージェントです。',
        "The agent inside each vault, following that vault's Schema.",
      ),
    routines: () =>
      t(
        'ルーティンの run ステップが使う実行環境を、この端末に用意します。ほかの種類のファイルやコマンドは、PATH にあるものを使います。',
        "Prepares the runtimes routines' run steps use on this device. Other files and commands use what is on PATH.",
      ),
    account: () =>
      t(
        `この端末の環境（vault、ワークスペース、ルーティン、設定など）を GitHub の非公開リポジトリ ${environmentRepository} に保存し、別の端末で復元できます。`,
        `Saves this device's environment (vaults, workspaces, routines, settings and more) to the private ${environmentRepository} repository on GitHub, to restore on another device.`,
      ),
    updates: () =>
      t(`irori ${appVersion} Preview を使っています。`, `This is irori ${appVersion} Preview.`),
  };
  const current = shownParts.find((item) => item.id === part) ?? shownParts[0];
  return (
    <>
      <button
        type="button"
        className={start ? 'start-settings' : 'rail-button settings-trigger'}
        aria-label={label}
        aria-haspopup="dialog"
        title={label}
        onClick={show}
      >
        <Icon name="sliders" size={start ? 14 : 18} />
        {start && t('設定', 'Settings')}
        {!start && waiting && (
          <span className="rail-badge" aria-label={t('更新あり', 'Update available')} />
        )}
      </button>
      {open && (
        <Dialog
          label={t('設定', 'Settings')}
          className="modal-dialog settings-dialog"
          closeOnBackdrop
          onClose={close}
        >
          <SettingsSheet
            parts={shownParts}
            current={current.id}
            summary={summary}
            onChoose={choosePart}
            onClose={close}
          >
            <Page key={current.id} part={current} lead={leads[current.id]()}>
              {pages[current.id]()}
            </Page>
          </SettingsSheet>
        </Dialog>
      )}
      {restoring && (
        <RestoreEnvironment onClose={() => setRestoring(false)} onRestored={onRestored} />
      )}
    </>
  );
}

/**
 * The settings as a sheet of their own over the blurred window, as an editor's
 * preferences are: the parts listed at the side in framed groups, each with its
 * current value, and the part chosen beside them.
 */
function SettingsSheet({
  parts: shown,
  current,
  summary,
  onChoose,
  onClose,
  children,
}: {
  parts: readonly Part[];
  current: PartId;
  summary: (id: PartId) => Summary;
  onChoose: (id: PartId) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  // Each part starts at its top. Newer scroll methods return a promise, which an
  // effect must not hand back to React as its cleanup.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [current]);
  return (
    <div className="settings-sheet chrome">
      <aside className="settings-side">
        <h2>{t('設定', 'Settings')}</h2>
        <nav aria-label={t('設定の項目', 'Settings sections')}>
          {groups.map((group) => {
            const items = shown.filter((part) => part.group === group.id);
            if (items.length === 0) return null;
            return (
              <div
                key={group.id}
                className="settings-nav-group"
                role="group"
                aria-labelledby={`${id}group-${group.id}`}
              >
                <span id={`${id}group-${group.id}`} className="settings-nav-label">
                  {group.label()}
                </span>
                <div className="settings-nav-frame">
                  {items.map((part) => {
                    const value = summary(part.id);
                    return (
                      <button
                        key={part.id}
                        type="button"
                        aria-current={current === part.id ? 'page' : undefined}
                        aria-labelledby={`${id}${part.id}`}
                        aria-describedby={`${id}${part.id}-value`}
                        onClick={() => onChoose(part.id)}
                      >
                        <Icon name={part.icon} size={16} />
                        <span id={`${id}${part.id}`} className="settings-nav-name">
                          {part.label()}
                        </span>
                        <small
                          id={`${id}${part.id}-value`}
                          className={`settings-nav-value ${value.attention ? 'attention' : ''}`}
                          title={value.text}
                        >
                          {value.text}
                        </small>
                        {value.badge && <span className="settings-nav-badge" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
      <div ref={body} className="settings-body">
        {children}
      </div>
      <button
        type="button"
        className="settings-close"
        aria-label={t('閉じる', 'Close')}
        title={t('閉じる', 'Close')}
        onClick={onClose}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
