import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { Icon, type IconName } from './Icon';
import { UpdateNotice, updateWaiting, useUpdateState } from './UpdateNotice';
import { AccountSection, RestoreEnvironment } from './AccountSync';
import { useChoice } from './useChoice';
import { useLanguage } from './useLanguage';
import {
  chooseLanguage,
  chooseLineSpacing,
  chooseMarkdownFont,
  choosePageMargins,
  chooseTextSize,
  chooseRoutineRuntimes,
  chooseTheme,
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
  lineSpacings,
  markdownFonts,
  pageMargins,
  textSizes,
  themes,
  type AgentAccess,
  type LineSpacing,
  type MarkdownFont,
  type PageMargins,
  type TextSize,
  type Theme,
} from '../domain/types';
import { languages, t, type Language } from '../domain/i18n';
import type { RoutineRuntime } from '../domain/routines';

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

const sizeLabels: Record<TextSize, () => string> = {
  small: () => t('小', 'Small'),
  standard: () => t('標準', 'Standard'),
  large: () => t('大', 'Large'),
  larger: () => t('特大', 'Larger'),
};

const spacingLabels: Record<LineSpacing, () => string> = {
  compact: () => t('詰める', 'Compact'),
  standard: () => t('標準', 'Standard'),
  relaxed: () => t('広い', 'Relaxed'),
};

// Each language is named in itself, so it can be found whichever is showing.
const languageLabels: Record<Language, string> = { ja: '日本語', en: 'English' };

function Choices<T extends string>({
  legend,
  name,
  value,
  options,
  label,
  shown = label,
  render,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly T[];
  label: (option: T) => string;
  /** A shorter text to show where the label does not fit; the label stays its name. */
  shown?: (option: T) => string;
  render?: (option: T) => ReactNode;
  onChange: (option: T) => void;
}) {
  return (
    <fieldset className={`settings-choices ${name}`}>
      <legend>{legend}</legend>
      <div>
        {options.map((option) => (
          <label
            key={option}
            className="settings-choice"
            data-checked={value === option}
            title={shown(option) === label(option) ? undefined : label(option)}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              aria-label={shown(option) === label(option) ? undefined : label(option)}
              onChange={() => onChange(option)}
            />
            {render?.(option)}
            <span>{shown(option)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The runtimes routines may use on this device (ADR 016 D3). Read when the
 * settings open, since a routine's row can add them too. Python downloads uv
 * first; turning it off keeps the download.
 */
function RoutineRuntimes({ onError }: { onError: (error: unknown) => void }) {
  const [javascript, choose] = useRuntime('javascript', onError);
  const [python, choosePython] = useRuntime('python', onError);
  return (
    <fieldset className="settings-choices routine-runtimes">
      {/* The section's heading says it already. */}
      <legend className="sr-only">{t('ルーティン', 'Routines')}</legend>
      <div>
        <label className="settings-choice" data-checked={javascript}>
          <input
            type="checkbox"
            checked={javascript}
            onChange={(event) => choose(event.target.checked)}
          />
          <Icon name="code" size={15} />
          <span>JavaScript</span>
        </label>
        <label className="settings-choice" data-checked={python}>
          <input
            type="checkbox"
            checked={python}
            onChange={(event) => choosePython(event.target.checked)}
          />
          <Icon name="code" size={15} />
          <span>Python</span>
        </label>
      </div>
    </fieldset>
  );
}

function useRuntime(name: RoutineRuntime, onError: (error: unknown) => void) {
  return useChoice(
    () => currentRoutineRuntimes().includes(name),
    async (on: boolean) => {
      if (on && name === 'python') await host.installPython();
      const others = currentRoutineRuntimes().filter((item) => item !== name);
      return chooseRoutineRuntimes(on ? [...others, name] : others);
    },
    onError,
  );
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
 * The settings: display choices shared by every workspace on this device, the
 * GitHub account with the environment saved there, and updates. The rail opens
 * them in a workspace; the start screen opens them before any workspace is, so
 * the environment can be saved from there too.
 */
export function Settings({
  start = false,
  vaultAgent,
  onVaultAgent,
  agentAccess,
  onAgentAccess,
  onRestored,
  onSchema,
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
  /** Opens every Schema: the shared one, the irori agent's and each vault's (ADR 027). */
  onSchema?: () => void;
  onError: (error: unknown) => void;
}) {
  const updates = useUpdateState(host);
  const [open, setOpen] = useState(false),
    [restoring, setRestoring] = useState(false);
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
  // The start screen's language switch changes the language beside these settings.
  const shown = useLanguage();
  useEffect(() => setLanguage(shown), [shown]);
  const label = t(
    `設定（テーマ：${themeLabels[theme]()}、Markdown：${fontLabels[font]()}、言語：${languageLabels[language]}）`,
    `Settings (theme: ${themeLabels[theme]()}, Markdown: ${fontLabels[font]()}, language: ${languageLabels[language]})`,
  );
  const close = () => setOpen(false);
  const parts = sections.filter((part) => !(start && part.id === 'updates'));
  return (
    <>
      <button
        type="button"
        className={start ? 'start-settings' : 'rail-button settings-trigger'}
        aria-label={label}
        aria-haspopup="dialog"
        title={label}
        onClick={() => setOpen(true)}
      >
        <Icon name="sliders" size={start ? 14 : 18} />
        {start && t('設定', 'Settings')}
        {!start && updateWaiting(updates) && (
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
          <SettingsSheet parts={parts} onClose={close}>
            <SettingsSection id="general">
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
              />
            </SettingsSection>
            <SettingsSection id="notes">
              <Choices
                legend={t('Markdown フォント', 'Markdown font')}
                name="markdown-font"
                value={font}
                options={markdownFonts}
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
              />
            </SettingsSection>
            <SettingsSection id="agents">
              <fieldset className="settings-choices vault-agent">
                <legend className="sr-only">{t('エージェント', 'Agents')}</legend>
                <div>
                  <label className="settings-choice" data-checked={vaultAgent}>
                    <input
                      type="checkbox"
                      checked={vaultAgent}
                      // Off hides the vault agents' columns and Schema; it does not stop CLIs in vaults.
                      title={t(
                        'オフにすると vault agent の列と Schema が隠れます。irori agent からの依頼とルーティンは、オフでも vault の中で CLI をその vault のエージェント設定で実行します。',
                        "Off hides the vault agents' columns and Schema. Hand-offs from the irori agent and routines still run a CLI inside the vault, with the vault's agent configuration.",
                      )}
                      onChange={(event) => onVaultAgent(event.target.checked)}
                    />
                    <Icon name="agent" size={15} />
                    <span>vault agent</span>
                  </label>
                </div>
              </fieldset>
              <Choices
                legend={t('新しい会話のアクセス', 'Access of a new conversation')}
                name="agent-access"
                value={agentAccess}
                options={agentAccessModes}
                label={(option) =>
                  option === 'full-access'
                    ? t('フルアクセス', 'Full access')
                    : t('標準（CLI の承認に従う）', "Standard (the CLI's approvals)")
                }
                shown={(option) =>
                  option === 'full-access'
                    ? t('フルアクセス', 'Full access')
                    : t('標準', 'Standard')
                }
                onChange={onAgentAccess}
              />
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
              {onSchema && (
                <fieldset className="settings-choices schema-settings">
                  <legend>Schema</legend>
                  <div>
                    <button
                      type="button"
                      className="settings-choice"
                      onClick={() => {
                        close();
                        onSchema();
                      }}
                    >
                      <Icon name="schema" size={15} />
                      <span>{t('共通・vault', 'Shared and vaults')}</span>
                    </button>
                  </div>
                </fieldset>
              )}
            </SettingsSection>
            <SettingsSection id="routines">
              <RoutineRuntimes onError={onError} />
            </SettingsSection>
            {/* The account section names itself (its heading and region). */}
            <div className="settings-section" data-section="account">
              <AccountSection
                onRestore={() => {
                  close();
                  setRestoring(true);
                }}
              />
            </div>
            {!start && (
              <section
                className="settings-section settings-updates"
                data-section="updates"
                aria-label={t('更新', 'Updates')}
              >
                <h3>{t('更新', 'Updates')}</h3>
                <UpdateNotice host={host} />
              </section>
            )}
          </SettingsSheet>
        </Dialog>
      )}
      {restoring && (
        <RestoreEnvironment onClose={() => setRestoring(false)} onRestored={onRestored} />
      )}
    </>
  );
}

/** The settings' parts, in the order the sheet shows them and its side list names them. */
const sections = [
  { id: 'general', icon: 'sliders', label: () => t('一般', 'General') },
  { id: 'notes', icon: 'file', label: () => t('ノート', 'Notes') },
  { id: 'agents', icon: 'agent', label: () => t('エージェント', 'Agents') },
  { id: 'routines', icon: 'routine', label: () => t('ルーティン', 'Routines') },
  { id: 'account', icon: 'user', label: () => t('アカウント', 'Account') },
  { id: 'updates', icon: 'refresh', label: () => t('更新', 'Updates') },
] as const satisfies readonly { id: string; icon: IconName; label: () => string }[];
type Section = (typeof sections)[number];

function SettingsSection({ id, children }: { id: Section['id']; children: ReactNode }) {
  const part = sections.find((item) => item.id === id)!;
  const heading = `settings-${id}`;
  return (
    <section className="settings-section" data-section={part.id} aria-labelledby={heading}>
      <h3 id={heading}>{part.label()}</h3>
      {children}
    </section>
  );
}

/**
 * The settings as a sheet of their own over the blurred window, as an editor's
 * preferences are: the parts listed at the side, all of them in one scrolling
 * column, the part in view marked in the list.
 */
function SettingsSheet({
  parts,
  onClose,
  children,
}: {
  parts: readonly Section[];
  onClose: () => void;
  children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Section['id']>(parts[0].id);
  // A jump from the list scrolls by itself; the part chosen stays marked until it ends.
  const jumping = useRef(false);
  const inView = () => {
    const box = body.current;
    if (!box || jumping.current) return;
    const top = box.getBoundingClientRect().top;
    const all = [...box.querySelectorAll<HTMLElement>('[data-section]')];
    let on = all[0]?.dataset.section;
    for (const part of all)
      if (part.getBoundingClientRect().top - top <= 48) on = part.dataset.section;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) on = all.at(-1)?.dataset.section;
    if (on) setShown(on as Section['id']);
  };
  const jump = (id: Section['id']) => {
    const box = body.current;
    const part = box?.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!box || !part) return;
    setShown(id);
    const distance = part.getBoundingClientRect().top - box.getBoundingClientRect().top;
    const room = box.scrollHeight - box.clientHeight - box.scrollTop;
    if (Math.abs(distance) < 1 || (distance > 0 && room < 1)) return;
    jumping.current = true;
    // Only the column scrolls: scrollIntoView would move the sheet inside its dialog too.
    box.scrollTo({
      top: box.scrollTop + distance,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };
  return (
    <div className="settings-sheet chrome">
      <aside className="settings-side">
        <h2>{t('設定', 'Settings')}</h2>
        <nav aria-label={t('設定の項目', 'Settings sections')}>
          {parts.map((part) => (
            <button
              key={part.id}
              type="button"
              aria-current={shown === part.id ? 'true' : undefined}
              onClick={() => jump(part.id)}
            >
              <Icon name={part.icon} size={15} />
              <span>{part.label()}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div
        ref={body}
        className="settings-body"
        onScroll={inView}
        onScrollEnd={() => {
          jumping.current = false;
        }}
      >
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
