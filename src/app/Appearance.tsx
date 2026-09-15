import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Icon } from './Icon';
import { chooseTheme, currentTheme } from './device-settings';
import type { DeviceSettings } from '../domain/types';

type ThemeChoice = DeviceSettings['theme'];

const labels: Record<ThemeChoice, string> = {
  system: 'システムに合わせる',
  light: 'ライト',
  dark: 'ダーク',
};

/** Lets the reader keep irori light on a dark desktop, or the other way round. */
export function Appearance({ onError }: { onError: (error: unknown) => void }) {
  const [choice, setChoice] = useState<ThemeChoice>(currentTheme);
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="appearance" aria-label={`表示テーマ（${labels[choice]}）`}>
        <Icon name="appearance" size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6}>
          <Menu.Popup className="appearance-menu">
            <Menu.RadioGroup
              value={choice}
              onValueChange={(value) => {
                const next = value as ThemeChoice;
                const previous = choice;
                setChoice(next);
                void chooseTheme(next).catch((error) => {
                  setChoice(previous);
                  onError(error);
                });
              }}
            >
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
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
