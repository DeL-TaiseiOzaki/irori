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
}
