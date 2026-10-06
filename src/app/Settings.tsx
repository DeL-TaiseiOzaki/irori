import { useState, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Icon } from './Icon';
import { UpdateNotice, updateWaiting, useUpdateState } from './UpdateNotice';
import { AccountSection, RestoreEnvironment } from './AccountSync';
import {
  chooseLanguage,
  chooseMarkdownFont,
  chooseRoutineRuntimes,
  chooseTheme,
  currentLanguageChoice,
  currentMarkdownFont,
  currentRoutineRuntimes,
  currentTheme,
} from './device-settings';
import { markdownFonts, themes, type MarkdownFont, type Theme } from '../domain/types';
import { languages, t, type Language } from '../domain/i18n';

const host = window.irori;

// Labels are functions so that they are read in the language of each render.
const themeLabels: Record<Theme, () => string> = {
  system: () => t('システムに合わせる', 'Match system'),
  hearth: () => t('いろり', 'Hearth'),
  light: () => t('ライト', 'Light'),
  dark: () => t('ダーク', 'Dark'),
};

const fontLabels: Record<MarkdownFont, () => string> = {
  system: () => t('システム', 'System'),
  sans: () => t('ゴシック', 'Sans-serif'),
  rounded: () => t('丸ゴシック', 'Rounded'),
  serif: () => t('明朝', 'Serif'),
  textbook: () => t('教科書体', 'Textbook'),
  mono: () => t('等幅', 'Monospace'),
};

// Each language is named in itself, so it can be found whichever is showing.
const languageLabels: Record<Language, string> = { ja: '日本語', en: 'English' };

/** One device-wide choice, applied at once and undone if the device record refuses it. */
function useChoice<T>(
  read: () => T,
  save: (value: T) => Promise<unknown>,
  onError: (e: unknown) => void,
) {
  const [value, setValue] = useState<T>(read);
  function choose(next: T) {
    const previous = value;
    setValue(next);
    void save(next).catch((error) => {
      setValue(previous);
      onError(error);
    });
  }
  return [value, choose] as const;
}

function Choices<T extends string>({
  legend,
  name,
  value,
  options,
  label,
  render,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly T[];
  label: (option: T) => string;
  render?: (option: T) => ReactNode;
  onChange: (option: T) => void;
}) {
  return (
    <fieldset className={`settings-choices ${name}`}>
      <legend>{legend}</legend>
      <div>
        {options.map((option) => (
          <label key={option} className="settings-choice" data-checked={value === option}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {render?.(option)}
            <span>{label(option)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The runtimes routines may use on this device (ADR 016 D3). Read when the
 * settings open, since a routine's row can add JavaScript too.
 */
function RoutineRuntimes({ onError }: { onError: (error: unknown) => void }) {
  const [javascript, choose] = useChoice(
    () => currentRoutineRuntimes().includes('javascript'),
    (on: boolean) => {
      const others = currentRoutineRuntimes().filter((runtime) => runtime !== 'javascript');
      return chooseRoutineRuntimes(on ? [...others, 'javascript'] : others);
    },
    onError,
  );
  return (
    <fieldset className="settings-choices routine-runtimes">
      <legend>{t('ルーティン', 'Routines')}</legend>
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
      </div>
    </fieldset>
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
 * The rail's settings: display choices shared by every workspace on this device,
 * the GitHub account with the environment saved there, and updates.
 */
export function Settings({
  hibachiAgent,
  onHibachiAgent,
  onRestored,
  onError,
}: {
  /** Each hibachi's own agent and its Schema layer are offered (ADR 021). */
  hibachiAgent: boolean;
  onHibachiAgent: (on: boolean) => void;
  /** The environment saved on the account was restored here (ADR 026). */
  onRestored: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const updates = useUpdateState(host);
  const [open, setOpen] = useState(false),
    [restoring, setRestoring] = useState(false);
  const [theme, chooseThemeValue] = useChoice(currentTheme, chooseTheme, onError);
  const [font, chooseFont] = useChoice(currentMarkdownFont, chooseMarkdownFont, onError);
  const [language, chooseLanguageValue] = useChoice<Language>(
    currentLanguageChoice,
    chooseLanguage,
    onError,
  );
  const label = t(
    `設定（テーマ：${themeLabels[theme]()}、Markdown：${fontLabels[font]()}、言語：${languageLabels[language]}）`,
    `Settings (theme: ${themeLabels[theme]()}, Markdown: ${fontLabels[font]()}, language: ${languageLabels[language]})`,
  );
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className="rail-button settings-trigger" aria-label={label} title={label}>
          <Icon name="sliders" size={18} />
          {updateWaiting(updates) && (
            <span className="rail-badge" aria-label={t('更新あり', 'Update available')} />
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="right" align="end" sideOffset={12}>
            <Popover.Popup className="settings-popover">
              <Popover.Title render={<h2 />}>{t('設定', 'Settings')}</Popover.Title>
              <Choices
                legend={t('テーマ', 'Theme')}
                name="theme"
                value={theme}
                options={themes}
                label={(option) => themeLabels[option]()}
                render={(option) => <Icon name={option} size={15} />}
                onChange={chooseThemeValue}
              />
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
                legend={t('言語', 'Language')}
                name="language"
                value={language}
                options={languages}
                label={(option) => languageLabels[option]}
                onChange={chooseLanguageValue}
              />
              <fieldset className="settings-choices hibachi-agent">
                <legend>{t('エージェント', 'Agents')}</legend>
                <div>
                  <label className="settings-choice" data-checked={hibachiAgent}>
                    <input
                      type="checkbox"
                      checked={hibachiAgent}
                      onChange={(event) => onHibachiAgent(event.target.checked)}
                    />
                    <Icon name="sparkles" size={15} />
                    <span>hibachi agent</span>
                  </label>
                </div>
              </fieldset>
              <RoutineRuntimes onError={onError} />
              <AccountSection
                onRestore={() => {
                  setOpen(false);
                  setRestoring(true);
                }}
              />
              <section className="settings-updates" aria-label={t('更新', 'Updates')}>
                <h3>{t('更新', 'Updates')}</h3>
                <UpdateNotice host={host} />
              </section>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {restoring && (
        <RestoreEnvironment onClose={() => setRestoring(false)} onRestored={onRestored} />
      )}
    </>
  );
}
