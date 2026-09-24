import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Icon } from './Icon';
import {
  chooseLanguage,
  chooseMarkdownFont,
  chooseTheme,
  currentLanguageChoice,
  currentMarkdownFont,
  currentTheme,
} from './device-settings';
import { markdownFonts, type DeviceSettings } from '../domain/types';
import { languages, t, type Language } from '../domain/i18n';

type ThemeChoice = DeviceSettings['theme'];
type MarkdownFontChoice = DeviceSettings['markdownFont'];

// Labels are functions so that they are read in the language of each render.
const labels: Record<ThemeChoice, () => string> = {
  system: () => t('システムに合わせる', 'Match system'),
  light: () => t('ライト', 'Light'),
  dark: () => t('ダーク', 'Dark'),
};

const fontLabels: Record<MarkdownFontChoice, () => string> = {
  system: () => t('システム', 'System'),
  sans: () => t('ゴシック', 'Sans-serif'),
  rounded: () => t('丸ゴシック', 'Rounded'),
  serif: () => t('明朝', 'Serif'),
  textbook: () => t('教科書体', 'Textbook'),
  mono: () => t('等幅', 'Monospace'),
};

// Each language is named in itself, so it can be found whichever is showing.
const languageLabels: Record<Language, string> = { ja: '日本語', en: 'English' };

/** Device-local display choices shared by every workspace. */
export function Appearance({ onError }: { onError: (error: unknown) => void }) {
  const [theme, setTheme] = useState<ThemeChoice>(currentTheme);
  const [markdownFont, setMarkdownFont] = useState<MarkdownFontChoice>(currentMarkdownFont);
  const [language, setLanguageChoice] = useState<Language>(currentLanguageChoice);
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className="appearance"
        aria-label={t(
          `表示設定（テーマ：${labels[theme]()}、Markdown：${fontLabels[markdownFont]()}、言語：${languageLabels[language]}）`,
          `Display settings (theme: ${labels[theme]()}, Markdown: ${fontLabels[markdownFont]()}, language: ${languageLabels[language]})`,
        )}
      >
        <Icon name="appearance" size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6}>
          <Menu.Popup className="appearance-menu">
            <Menu.RadioGroup
              value={theme}
              onValueChange={(value) => {
                const next = value as ThemeChoice;
                const previous = theme;
                setTheme(next);
                void chooseTheme(next).catch((error) => {
                  setTheme(previous);
                  onError(error);
                });
              }}
            >
              <Menu.GroupLabel className="appearance-menu-label">
                {t('テーマ', 'Theme')}
              </Menu.GroupLabel>
              {(['system', 'light', 'dark'] as const).map((value) => (
                // A theme is one choice, so taking it closes the menu.
                <Menu.RadioItem key={value} value={value} closeOnClick>
                  <Icon name={value} size={14} />
                  <span>{labels[value]()}</span>
                  <Menu.RadioItemIndicator>
                    <Icon name="check" size={14} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <div className="appearance-menu-divider" role="separator" />
            <Menu.RadioGroup
              value={markdownFont}
              onValueChange={(value) => {
                const next = value as MarkdownFontChoice;
                const previous = markdownFont;
                setMarkdownFont(next);
                void chooseMarkdownFont(next).catch((error) => {
                  setMarkdownFont(previous);
                  onError(error);
                });
              }}
            >
              <Menu.GroupLabel className="appearance-menu-label">
                {t('Markdown フォント', 'Markdown font')}
              </Menu.GroupLabel>
              {markdownFonts.map((value) => (
                <Menu.RadioItem
                  key={value}
                  value={value}
                  closeOnClick
                  aria-label={fontLabels[value]()}
                >
                  <span className={`font-swatch font-${value}`} aria-hidden="true">
                    文
                  </span>
                  <span className={`font-${value}`}>{fontLabels[value]()}</span>
                  <Menu.RadioItemIndicator>
                    <Icon name="check" size={14} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <div className="appearance-menu-divider" role="separator" />
            <Menu.RadioGroup
              value={language}
              onValueChange={(value) => {
                const next = value as Language;
                const previous = language;
                setLanguageChoice(next);
                void chooseLanguage(next).catch((error) => {
                  setLanguageChoice(previous);
                  onError(error);
                });
              }}
            >
              <Menu.GroupLabel className="appearance-menu-label">
                {t('言語', 'Language')}
              </Menu.GroupLabel>
              {languages.map((value) => (
                <Menu.RadioItem key={value} value={value} closeOnClick lang={value}>
                  <span>{languageLabels[value]}</span>
                  <Menu.RadioItemIndicator>
                    <Icon name="check" size={14} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
