export type UpdateTarget = 'release' | 'download';

export interface PublishedUpdate {
  version: string;
  tag: string;
  releaseUrl: string;
  downloadUrl: string;
}

export interface UpdateCheck {
  status: 'current' | 'available' | 'unsupported' | 'error';
  currentVersion: string;
  detail: string;
  release?: PublishedUpdate;
  reason?: 'offline' | 'timeout' | 'rate-limited' | 'invalid' | 'unavailable';
  /** For an available release: whether this installation can apply it itself, or why not. */
  install?: { available: true } | { available: false; detail: string };
}

/** Applying a published version from inside the application, one phase at a time. */
export type UpdateInstall =
  | { phase: 'idle' }
  | { phase: 'downloading'; version: string; received: number; total: number }
  | { phase: 'preparing'; version: string }
  | { phase: 'ready'; version: string }
  | { phase: 'failed'; version: string; detail: string };

export interface UpdateState {
  /** The latest completed check, including one the application made by itself. */
  check?: UpdateCheck;
  install: UpdateInstall;
}
