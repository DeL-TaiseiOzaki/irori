import { expect, type Locator, type Page } from '@playwright/test';

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How a conversation runs, as its column offers it under the instruction box: one button that
 * names the model, the thinking level and the access in use, and a menu that sets them
 * (ADR 059). `scope` is the page, or one agent column where several are open.
 */
export function runSettings(scope: Page | Locator) {
  const page = 'keyboard' in scope ? scope : scope.page();
  const button = scope.getByRole('button', { name: /^会話の設定/ });
  const menu = page.getByRole('menu');
  const choice = (name: string) => menu.getByRole('menuitemradio', { name, exact: true });
  const open = async () => {
    if ((await menu.count()) === 0) await button.click();
    await expect(menu).toBeVisible();
  };
  const close = async () => {
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  };
  return {
    button,
    menu,
    choice,
    open,
    close,
    /** Chooses a model, a thinking level or an access by its name, and closes the menu. */
    async choose(name: string) {
      await open();
      await choice(name).click();
      await close();
    },
    /** The model the button names; '' is the CLI's own default. */
    model: (name: string) =>
      expect(button).toHaveAccessibleName(
        new RegExp(`モデル: ${literal(name || 'CLI の既定')}[、）]`),
      ),
    /** The thinking level the button names; '' is the default. */
    effort: (level: string) =>
      expect(button).toHaveAccessibleName(new RegExp(`思考量: ${literal(level || '既定')}[、）]`)),
    /** The access the button names: full access, or whatever the CLI's standard one is called. */
    async access(access: 'default' | 'full-access') {
      if (access === 'full-access')
        await expect(button).toHaveAccessibleName(/アクセス: フルアクセス）$/);
      else {
        await expect(button).toHaveAccessibleName(/アクセス: /);
        await expect(button).not.toHaveAccessibleName(/アクセス: フルアクセス/);
      }
    },
  };
}
