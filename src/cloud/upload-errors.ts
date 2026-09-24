import { StringDecoder } from 'node:string_decoder';
import { t } from '../domain/i18n';

/**
 * Why saved changes are not reaching Google Drive.
 *
 * rclone reports every failed upload attempt once, as an ERROR line on stderr
 * (rclone v1.75.1: vfs/vfscache/writeback/writeback.go `upload`, printed by
 * fs/log/slog.go `formatStdLogHeader`):
 *
 *   2026/09/25 12:00:00 ERROR : folder/file.md: vfs cache: failed to upload try #2,
 *   will retry in 20s: vfs cache: failed to transfer file from cache to remote:
 *   googleapi: Error 403: The user does not have sufficient permissions for this
 *   file., insufficientFilePermissions
 *
 * The line names the file as rclone's upload queue names it and ends with the
 * provider's error, which can carry file ids, addresses and machine paths. Only
 * the file's path and a fixed category are kept from it.
 */
export type UploadErrorCategory =
  'permission' | 'quota' | 'auth' | 'network' | 'rateLimit' | 'other';
export interface UploadFailure {
  /** The file inside the mounted folder, as `vfs/queue` names it. */
  path: string;
  category: UploadErrorCategory;
}

// What the provider's error says, in order of precedence: a 403 also carries
// Google's rate and storage limits, and refreshing a sign-in can fail for a
// network reason, so the more specific words are tried first. Google's reasons
// (developers.google.com/workspace/drive/api/guides/handle-errors) arrive as
// `googleapi: Error <code>: <message>, <reason>`; a refused sign-in as
// `oauth2: "invalid_grant" …` or rclone's `invalid_grant: maybe token expired?`;
// a connection failure as a Go net error such as `dial tcp: … no such host`.
const categories: [UploadErrorCategory, RegExp][] = [
  ['rateLimit', /rate.?limit|dailyLimitExceeded|Error 429|too many requests/i],
  ['quota', /storage.?quota|quotaExceeded/i],
  [
    'network',
    /dial tcp|no such host|name resolution|getaddrinfo|server misbehaving|connection refused|connection reset|forcibly closed|broken pipe|unreachable|no route to host|timeout|timed out|context deadline exceeded|\bEOF\b|connection lost|connectex:|wsarecv:|wsasend:|Error 50\d|bad gateway|service unavailable/i,
  ],
  [
    'auth',
    /invalid_grant|Error 401|authError|Invalid Credentials|couldn't fetch token|token expired|oauth2:|unauthorized_client|invalid_client|invalid_scope|expired or revoked|insufficientPermissions|authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|appNotAuthorizedToFile|unauthorized/i,
  ],
  ['permission', /Error 403|permission|forbidden|domainPolicy|not allowed/i],
];

/** The category a provider error belongs to; `other` when its words are not recognised. */
export function classifyUploadError(detail: string): UploadErrorCategory {
  return categories.find(([, words]) => words.test(detail))?.[0] ?? 'other';
}

// `%-6s: ` pads the level to six characters, so the header ends in `ERROR : `.
const header = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{6})? ERROR : /;
const marker = ': vfs cache: failed to upload try #';

/** The failure one line of rclone's log reports, if it reports a failed upload. */
export function parseUploadFailure(line: string): UploadFailure | undefined {
  const start = header.exec(line)?.[0].length;
  if (!start) return;
  // The file name may itself contain ": ", so the marker after it locates its end.
  const end = line.indexOf(marker, start);
  if (end <= start) return;
  return {
    path: line.slice(start, end),
    // Only the words after the name are read, so a file's name never chooses the category.
    category: classifyUploadError(line.slice(end + marker.length)),
  };
}

/** The last upload failures rclone logged, as nothing but a path and a category each. */
export class UploadFailures {
  private failures: UploadFailure[] = [];
  private decoder = new StringDecoder('utf8');
  // The part of the current line that has arrived: a name can be cut between chunks.
  private partial = '';
  constructor(private limit = 100) {}
  /** Reads a chunk of rclone's stderr. */
  feed(chunk: Buffer | string) {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const lines = (this.partial + text).split('\n');
    this.partial = lines.pop()!.slice(-8192);
    for (const line of lines) {
      const failure = parseUploadFailure(line.replace(/\r$/, ''));
      if (!failure) continue;
      this.failures.push(failure);
      if (this.failures.length > this.limit) this.failures.shift();
    }
  }
  /** Oldest first. */
  list(): UploadFailure[] {
    return this.failures.map((failure) => ({ ...failure }));
  }
}

/** One line for the connection card: what is wrong and how many changes it holds back. */
export function uploadErrorMessage(category: UploadErrorCategory, count: number) {
  switch (category) {
    case 'permission':
      return t(
        `このフォルダに書き込む権限がありません（閲覧のみで共有されている可能性があります）。${count} 件の変更を Google Drive に送信できません。`,
        `You do not have permission to write to this folder (it may be shared view-only). ${count} changes cannot be uploaded to Google Drive.`,
      );
    case 'quota':
      return t(
        `Google Drive の保存容量がいっぱいです。${count} 件の変更を送信できません。空き容量を確保してください。`,
        `Google Drive storage is full. ${count} changes cannot be uploaded. Free up space to continue.`,
      );
    case 'auth':
      return t(
        `Google へのログインが期限切れか取り消されています。${count} 件の変更を送信できません。アカウントの「書き込みを許可」または「再ログイン」でログインし直してください。`,
        `The Google sign-in has expired or been revoked. ${count} changes cannot be uploaded. Sign in again with “Allow writing” or “Sign in again” on the account.`,
      );
    case 'network':
      return t(
        `Google Drive に接続できません（オフラインか通信エラー）。${count} 件の変更は接続が戻ると自動で送信されます。`,
        `Google Drive cannot be reached (offline or a connection error). ${count} changes will be uploaded automatically once the connection is back.`,
      );
    case 'rateLimit':
      return t(
        `Google がリクエストを制限しています。${count} 件の変更は自動で再試行されます。`,
        `Google is limiting requests. ${count} changes will be retried automatically.`,
      );
    default:
      return t(
        `${count} 件の変更を Google Drive に送信できませんでした。自動で再試行しますが、続く場合は irori を再起動してフォルダを接続し直してください。`,
        `${count} changes could not be uploaded to Google Drive. They are retried automatically; if this continues, restart irori and connect the folder again.`,
      );
  }
}
