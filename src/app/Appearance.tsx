import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Icon } from './Icon';
import {
  chooseMarkdownFont,
  chooseTheme,
  currentMarkdownFont,
  currentTheme,
} from './device-settings';
import type { DeviceSettings } from '../domain/types';

type ThemeChoice = DeviceSettings['theme'];
type MarkdownFontChoice = DeviceSettings['markdownFont'];

const labels: Record<ThemeChoice, string> = {
  system: 'システムに合わせる',
  light: 'ライト',
  dark: 'ダーク',
};

const fontLabels: Record<MarkdownFontChoice, string> = {
  sans: 'ゴシック',
  serif: '明朝',
  mono: '等幅',
};

/** Device-local display choices shared by every workspace. */
export function Appearance({ onError }: { onError: (error: unknown) => void }) {
  const [theme, setTheme] = useState<ThemeChoice>(currentTheme);
  const [markdownFont, setMarkdownFont] = useState<MarkdownFontChoice>(currentMarkdownFont);
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className="appearance"
        aria-label={`表示設定（テーマ：${labels[theme]}、Markdown：${fontLabels[markdownFont]}）`}
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
              <Menu.GroupLabel className="appearance-menu-label">テーマ</Menu.GroupLabel>
              {(['system', 'light', 'dark'] as const).map((value) => (
                // A theme is one choice, so taking it closes the menu.
                <Menu.RadioItem key={value} value={value} closeOnClick>
                  <Icon name={value} size={14} />
                  <span>{labels[value]}</span>
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
              <Menu.GroupLabel className="appearance-menu-label">Markdown フォント</Menu.GroupLabel>
              {(['sans', 'serif', 'mono'] as const).map((value) => (
                <Menu.RadioItem
                  key={value}
                  value={value}
                  closeOnClick
                  aria-label={fontLabels[value]}
                >
                  <span className={`font-swatch font-${value}`} aria-hidden="true">
                    文
                  </span>
                  <span className={`font-${value}`}>{fontLabels[value]}</span>
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
