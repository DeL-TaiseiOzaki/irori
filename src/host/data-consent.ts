import path from 'node:path';
import { z } from 'zod';
import { agentIds, agentNames, type AgentId } from '../domain/types';
import { t } from '../domain/i18n';
import { readLocalJson, writeLocalJson } from './local-json';
import { SerialQueue } from './serial-queue';

export const dataConsentVersion = 1;
export const dataConsentPurposes = ['google', 'programs', ...agentIds] as const;
export type DataConsentPurpose = (typeof dataConsentPurposes)[number];
const receipts = z.object({
  version: z.number().int(),
  accepted: z.partialRecord(z.enum(dataConsentPurposes), z.string().datetime()).default({}),
});

/** Acknowledges the disclosure, not provider compliance or permission for every tool call. */
export class DataConsent {
  private queue = new SerialQueue();
  private pending = new Map<DataConsentPurpose, Promise<void>>();
  private file: string;
  constructor(
    dataDir: string,
    private confirm: (purpose: DataConsentPurpose) => Promise<boolean>,
  ) {
    this.file = path.join(dataDir, 'data-consent.json');
  }
  private async read() {
    const value = receipts.parse(
      await readLocalJson(this.file, { version: dataConsentVersion, accepted: {} }),
    );
    return value.version === dataConsentVersion ? value.accepted : {};
  }
  async require(purpose: DataConsentPurpose) {
    if (!(await this.read())[purpose])
      throw Error(
        t(
          '接続・実行前にデータ利用を確認してください。',
          'Confirm data use before connecting or running.',
        ),
      );
  }
  allow(purpose: DataConsentPurpose) {
    const waiting = this.pending.get(purpose);
    if (waiting) return waiting;
    const operation = this.queue.run(async () => {
      const accepted = await this.read();
      if (accepted[purpose]) return;
      if (!(await this.confirm(purpose)))
        throw Error(t('データ利用への同意を取り消しました。', 'Data use was not accepted.'));
      accepted[purpose] = new Date().toISOString();
      await writeLocalJson(this.file, { version: dataConsentVersion, accepted });
    });
    this.pending.set(purpose, operation);
    void operation.finally(() => this.pending.delete(purpose)).catch(() => {});
    return operation;
  }
  /** Confirm again on the next use; this does not revoke OAuth or delete retained data. */
  reset() {
    return this.queue.run(() =>
      writeLocalJson(this.file, { version: dataConsentVersion, accepted: {} }),
    );
  }
}

export function dataUseDisclosure(purpose: DataConsentPurpose) {
  if (purpose === 'google')
    return {
      title: t('Google Drive の利用', 'Google Drive data use'),
      detail: t(
        'Google では Drive 全体の読み書き権限を求めます。irori は選択したフォルダを接続し、ファイルと変更をこの端末に保存します。接続を解除しても、キャッシュ・資料のコピー・履歴は残ることがあります。AI・プログラムからの利用は別途確認します。',
        'Google grants access to read and change all Drive files. irori connects your selected folders and stores files and pending changes on this device. Disconnecting may leave caches, retained material copies and history. AI and program use is confirmed separately.',
      ),
    };
  if (purpose === 'programs')
    return {
      title: t('プログラムのデータ利用', 'Program data use'),
      detail: t(
        'ターミナルとルーティンのプログラムは、Drive を含むアクセス可能なファイルを読み、外部サービスへ送信できます。実行する内容と送信先を確認してください。この確認は個々の通信を制限しません。',
        'Terminal commands and routine programs can read accessible files, including Drive files, and send them to external services. Review the programs and their destinations. This confirmation does not restrict individual network requests.',
      ),
    };
  const name = agentNames[purpose as AgentId];
  return {
    title: t(`${name} のデータ利用`, `${name} data use`),
    detail: t(
      '指示・読んだファイル・ツール出力は、この CLI と設定された AI サービス・ツールに送信され、irori や CLI の履歴に保存されます。Drive のファイルとサブエージェントも対象です。入力を学習に使わない設定のアカウントでのみ使用してください。Drive データを汎用 AI の学習に使うことはできません。この確認は個々のツール実行の承認ではありません。',
      'Instructions, files read and tool output are sent to this CLI and its configured AI services and tools, and may be retained in irori and CLI histories. This includes Drive files and subagents. Use it only with an account whose provider does not train models on your inputs. Drive data must not be used to train general AI models. This confirmation does not approve each individual tool invocation.',
    ),
  };
}
