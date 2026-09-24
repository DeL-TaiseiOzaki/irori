import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { DraftController, type DraftKey, type DraftState } from '../domain/drafts';
import { t } from '../domain/i18n';

const empty: DraftState = { text: '', record: null, ready: false, pending: false, error: '' };
const noopSubscribe = () => () => {};
const activeDrafts = new Set<DraftController>();
const mountedDrafts = new Map<DraftController, number>();
const controllers = new Map<string, DraftController>();

function forget(controller: DraftController) {
  activeDrafts.delete(controller);
  for (const [key, cached] of controllers) if (cached === controller) controllers.delete(key);
}

export async function flushDrafts(): Promise<void> {
  const results = await Promise.all(
    [...activeDrafts].map(async (controller) => {
      const saved = await controller.flush();
      if (saved && !mountedDrafts.has(controller)) forget(controller);
      return saved;
    }),
  );
  if (results.some((saved) => !saved))
    throw Error(
      t(
        '下書きを保存できません。画面の保存エラーを確認して再試行してください。',
        'Could not save the draft. Check the on-screen save error and try again.',
      ),
    );
}

/** Include canonical checkout identity in addition to the key when a renderer target can change. */
export function useDraft(key: DraftKey | null, identity = '') {
  const encoded = JSON.stringify(key);
  const cacheKey = `${identity}\0${encoded}`;
  const controller = useMemo(() => {
    if (!key) return null;
    let current = controllers.get(cacheKey);
    if (!current) {
      current = new DraftController(key, window.irori);
      controllers.set(cacheKey, current);
    }
    return current;
  }, [cacheKey]);
  const state = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.snapshot ?? (() => empty),
  );
  useEffect(() => {
    if (!controller) return;
    controllers.set(cacheKey, controller);
    activeDrafts.add(controller);
    mountedDrafts.set(controller, (mountedDrafts.get(controller) ?? 0) + 1);
    void controller.load();
    return () => {
      const remaining = (mountedDrafts.get(controller) ?? 1) - 1;
      if (remaining) mountedDrafts.set(controller, remaining);
      else mountedDrafts.delete(controller);
      void controller.flush().then((saved) => {
        if (saved && !mountedDrafts.has(controller)) forget(controller);
      });
    };
  }, [controller, cacheKey]);
  return {
    ...state,
    setText: controller?.setText ?? (() => {}),
    flush: controller?.flush ?? (async () => true),
    clear: controller?.clear ?? (async () => true),
    retry: controller?.retry ?? (async () => true),
    snapshot: controller?.snapshot ?? (() => empty),
  };
}
