import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { SettingsService } from '../src/host/settings';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// The session board (ADR 069): every conversation of the workspace that is doing
// something shows as a card in its lane, right of the agents' columns. A run moves
// its card from 実行中 to 完了 while another conversation is on show, a card opens
// its conversation, a request puts its card under 要対応, a CLI's own sub-agent
// shows as a framed card under its conversation, and the settings take the board
// off the window. `pi` is a protocol fixture; no model runs.
if (process.platform === 'win32') {
  console.log('Session board UI executable fixtures are POSIX only.');
  process.exit(0);
}
const base = await mkdtemp(path.join(tmpdir(), 'irori session board UI '));
const home = path.join(base, 'home');
await mkdir(home);
const files = new FileService(path.join(base, 'device'));
await files.init();
// The vault agent's columns are off until turned on (ADR 021).
await new SettingsService(files.dataDir).save({ vaultAgent: true });
const root = path.join(base, 'KB');
await mkdir(root);
await writeFile(path.join(root, 'note.md'), '# Board fixture\n');
await files.register(root, 'ボード検証', 'personal');
const bin = path.join(base, 'bin');
await mkdir(bin);
await writeFile(
  path.join(bin, 'pi'),
  `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('pi'));\n`,
  { mode: 0o700 },
);
await chooseJapanese(files.dataDir);
const env = {
  ...process.env,
  HOME: home,
  PATH: bin + path.delimiter + process.env.PATH,
  IRORI_DATA_DIR: files.dataDir,
} as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const errors: string[] = [];
await mkdir('test-results', { recursive: true });

const panel = (page: Page) => page.getByRole('complementary', { name: 'ボード検証 agent' });
const board = (page: Page) => page.getByRole('complementary', { name: 'セッションボード' });
const lane = (page: Page, name: string) => board(page).getByRole('region', { name, exact: true });
const card = (page: Page, title: string) =>
  board(page).locator('.session-card:not(.sub-agent)').filter({ hasText: title });
async function send(page: Page, text: string) {
  await panel(page).getByLabel('エージェントへの指示').fill(text);
  await panel(page).getByRole('button', { name: '送信', exact: true }).click();
}
async function quit(app: ElectronApplication) {
  let stuck = false;
  const timer = setTimeout(() => {
    stuck = true;
    app.process().kill('SIGKILL');
  }, 15000);
  try {
    await app.close();
  } finally {
    clearTimeout(timer);
  }
  if (stuck) throw Error('irori did not quit within 15 s');
}

const app = await electron.launch({
  args: [
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '.',
  ],
  env,
});
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(20000);
  await page.getByRole('checkbox', { name: /ボード検証/ }).check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  await page.getByRole('button', { name: 'vault agent', exact: true }).click();

  // The board stands left of the column, and says so while nothing is doing anything.
  await expect(board(page)).toBeVisible();
  const boardBox = await board(page).boundingBox();
  const panelBox = await panel(page).boundingBox();
  if (!boardBox || !panelBox || boardBox.x <= panelBox.x)
    throw Error('The session board is not right of the agent column');
  await expect(board(page)).toContainText('動いている会話はありません');
  await panel(page).getByLabel('エージェント', { exact: true }).selectOption('pi');

  // A run shows as a card under 実行中, with what was asked and the step it takes.
  await send(page, '最初の話題\nrun: sleep 4');
  await expect(lane(page, '実行中')).toBeVisible();
  await expect(card(page, '最初の話題')).toHaveCount(1);
  await expect(
    lane(page, '実行中').locator('.session-card').filter({ hasText: '最初の話題' }),
  ).toHaveCount(1);
  await expect(card(page, '最初の話題').getByRole('img', { name: '実行中' })).toHaveCount(1);
  // A card names only the request and its CLI; pointing at it shows the rest beside it.
  await expect(card(page, '最初の話題').locator('.session-card-foot')).toHaveText('Pi');
  await expect(card(page, '最初の話題')).not.toContainText('ボード検証');
  const detail = page.getByRole('tooltip');
  await card(page, '最初の話題').hover();
  await expect(detail).toContainText('最初の話題\nrun: sleep 4');
  await expect(detail).toContainText('経過時間');
  await expect(detail).toContainText('既定のモデル');
  const cardBox = (await card(page, '最初の話題').boundingBox())!;
  const detailBox = (await detail.boundingBox())!;
  // The board stands at the window's right edge: its panel opens to its left.
  if (detailBox.x + detailBox.width > cardBox.x)
    throw Error('The panel covers the card it tells about');
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height + 400);
  await expect(detail).toHaveCount(0);

  // The board's width follows its handle.
  const handle = page.getByRole('separator', { name: 'セッションボードの幅' });
  const handleBox = (await handle.boundingBox())!;
  const before = (await board(page).boundingBox())!.width;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 80, handleBox.y + handleBox.height / 2, { steps: 8 });
  await page.mouse.up();
  const after = (await board(page).boundingBox())!.width;
  if (after < before + 60) throw Error(`The board did not widen: ${before} → ${after}`);

  // Another conversation runs beside it; its CLI's own sub-agent is a framed card under it.
  await panel(page).getByRole('button', { name: '新しい会話', exact: true }).click();
  await send(page, '二つ目 subagent hold');
  await expect(card(page, '二つ目 subagent hold')).toHaveCount(1);
  const subs = board(page).getByRole('list', { name: '二つ目 subagent hold のサブセッション' });
  const sub = subs.locator('.session-card.sub-agent');
  await expect(sub).toHaveCount(1);
  await expect(sub).toContainText('Find the notes');
  await expect(sub).toContainText('scout');
  await expect(sub.getByRole('img', { name: '実行中' })).toHaveCount(1);
  // Its frame is not a parent card's.
  // No function is declared inside: the page would lack the helper tsx names them with.
  const frames = {
    parent: await card(page, '最初の話題').evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    ),
    child: await sub.evaluate((element) => getComputedStyle(element).borderTopColor),
    style: await sub.evaluate((element) => getComputedStyle(element).borderTopStyle),
  };
  if (!frames.child || frames.child === frames.parent || frames.style !== 'dashed')
    throw Error(`A sub-agent's card is framed as its parent's: ${JSON.stringify(frames)}`);
  // It stands indented under its parent, on the sub-sessions' rule.
  const parentBox = await card(page, '二つ目 subagent hold').boundingBox();
  const subBox = await sub.boundingBox();
  const rule = await subs.evaluate((element) => getComputedStyle(element).borderLeftStyle);
  if (!parentBox || !subBox || subBox.x < parentBox.x + 8 || rule !== 'solid')
    throw Error(`A sub-agent's card is not indented under its parent (${rule})`);
  await page.screenshot({ path: 'test-results/irori-session-board-running.png' });

  // The first run ends while the second is on show: its card moves to 完了.
  await expect(
    lane(page, '完了').locator('.session-card').filter({ hasText: '最初の話題' }),
  ).toHaveCount(1, { timeout: 20000 });
  await expect(card(page, '最初の話題').getByRole('img', { name: '完了' })).toHaveCount(1);
  // A card opens its conversation in the column, and what it did is then seen.
  await card(page, '最初の話題').click();
  await expect(panel(page).locator('.message.user')).toHaveText(['最初の話題\nrun: sleep 4']);
  await expect(
    lane(page, '開いている').locator('.session-card').filter({ hasText: '最初の話題' }),
  ).toHaveCount(1);
  await expect(card(page, '最初の話題')).toHaveClass(/current/);

  // Stopping the second run ends its sub-agent with it.
  await card(page, '二つ目 subagent hold').click();
  await panel(page).getByRole('button', { name: '停止', exact: true }).click();
  await expect(
    lane(page, '実行中').locator('.session-card').filter({ hasText: '二つ目' }),
  ).toHaveCount(0);
  await expect(sub.getByRole('img', { name: '実行中' })).toHaveCount(0);

  // A run that asks the person is under 要対応 with its request.
  await panel(page).getByRole('button', { name: '新しい会話', exact: true }).click();
  await send(page, '三つ目 dialog');
  await expect(
    lane(page, '要対応').locator('.session-card').filter({ hasText: '三つ目 dialog' }),
  ).toHaveCount(1);
  await expect(card(page, '三つ目 dialog').getByRole('img', { name: '許可待ち' })).toHaveCount(1);
  await card(page, '三つ目 dialog').hover();
  await expect(page.getByRole('tooltip')).toContainText('質問');
  await expect(page.getByRole('tooltip')).toContainText('Fixture confirmation');
  await page.screenshot({ path: 'test-results/irori-session-board-attention.png' });
  await panel(page).getByRole('button', { name: '停止', exact: true }).click();
  await expect(lane(page, '要対応')).toHaveCount(0);

  // The settings take the board off the window, and put it back.
  const settings = page.getByRole('button', { name: /^設定（/ });
  const sheet = page.getByRole('dialog', { name: '設定', exact: true });
  await settings.click();
  await sheet
    .getByRole('navigation', { name: '設定の項目' })
    .getByRole('button', { name: '画面に出すもの' })
    .click();
  await sheet.getByRole('switch', { name: 'セッションボード', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(board(page)).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await settings.click();
  await sheet.getByRole('switch', { name: 'セッションボード', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(card(page, '最初の話題')).toHaveCount(1);

  // A card's × closes its conversation: the card goes, and the column shows another.
  // `has` matches inside each row, so its locator starts from the row, not the board.
  const row = (title: string) =>
    board(page)
      .locator('.session-card-row')
      .filter({ has: page.locator('.session-card:not(.sub-agent)', { hasText: title }) });
  const userMessage = (text: string) =>
    panel(page).locator('.message.user').filter({ hasText: text });
  await row('三つ目 dialog').hover();
  await expect(row('三つ目 dialog').locator('.session-close')).toHaveCSS('opacity', '1');
  await row('三つ目 dialog')
    .getByRole('button', { name: /^閉じる: / })
    .click();
  await expect(card(page, '三つ目 dialog')).toHaveCount(0);
  await expect(userMessage('三つ目 dialog')).toHaveCount(0);
  // On a run in progress it stops the run too, and the run's end does not bring it back.
  await panel(page).getByRole('button', { name: '新しい会話', exact: true }).click();
  await send(page, '四つ目 hold');
  await expect(
    lane(page, '実行中').locator('.session-card').filter({ hasText: '四つ目 hold' }),
  ).toHaveCount(1);
  await row('四つ目 hold').hover();
  await row('四つ目 hold')
    .getByRole('button', { name: /^停止して閉じる: / })
    .click();
  await expect(card(page, '四つ目 hold')).toHaveCount(0);
  await expect(userMessage('四つ目 hold')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(card(page, '四つ目 hold')).toHaveCount(0);
  await expect(board(page).getByRole('img', { name: '実行中' })).toHaveCount(0);
  // Closing the column's last conversation leaves it an empty one, not that one again.
  const cards = board(page).locator('.session-card-row');
  for (let left = 8; left > 0 && (await cards.count()) > 0; left--) {
    await cards.first().hover();
    await cards.first().locator('.session-close').click();
  }
  await expect(panel(page).locator('.message.user')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(cards).toHaveCount(0);
  await page.screenshot({ path: 'test-results/irori-session-board-closed.png' });

  if (errors.length) throw Error(`Renderer errors:\n${errors.join('\n')}`);
} catch (error) {
  // A run may still hold the app open; the failure is what matters.
  await quit(app).catch(() => {});
  throw error;
}
await quit(app);
console.log('Session board UI smoke passed.');
