import { lazy, Suspense, useRef } from 'react';
import { isPropertyPage } from '../domain/scopes';
import { t } from '../domain/i18n';
import { lineTarget, type SearchTarget } from '../editor/search-navigation';
import type { Space } from '../domain/types';
import { useResource } from './useResource';

const PageEditor = lazy(() => import('./PageEditor').then((m) => ({ default: m.PageEditor })));
const CsvPreview = lazy(() => import('./CsvPreview').then((m) => ({ default: m.CsvPreview })));
const FileViewer = lazy(() => import('./FileViewer').then((m) => ({ default: m.FileViewer })));

const host = window.irori;
const ignore = () => {};

/** A place to bring into view once: a search hit, or a line a path link names. */
export type PreviewTarget = { line: number; search?: SearchTarget; n: number };

/**
 * The file on show in a stage column without the focus (ADR 052), and in irori
 * mode's files view (ADR 068): read from the vault and shown as the editor would,
 * without editing. It is read again when the vault's files change, so a save in
 * the focused column shows here too. A target is brought into view when it comes,
 * not again when the file is read again, so an agent's edits do not move the reader.
 */
export function StagePreview({
  space,
  path,
  revision,
  target,
  onFollowLink,
  onError,
}: {
  space: Space;
  path: string;
  revision: number;
  target?: PreviewTarget;
  onFollowLink?: (href: string) => void;
  onError: (error: unknown) => void;
}) {
  const applied = useRef<number>(undefined);
  const read = useResource(() => host.read(space.scopeId, path), [space.scopeId, path], {
    refresh: revision,
  });
  const doc = read.data;
  const rich = /\.md$/i.test(path);
  const pending = target && applied.current !== target.n ? target : undefined;
  if (!doc)
    return read.error ? (
      <p className="hint" role="status">
        {read.error}
      </p>
    ) : null;
  return (
    <div className="document-scroll">
      <Suspense fallback={<p className="hint">{t('開いています…', 'Opening…')}</p>}>
        {doc.viewer ? (
          <FileViewer
            key={doc.hash}
            doc={{ ...doc, viewer: doc.viewer }}
            load={(scopeId, file) => host.viewerBytes(scopeId, file)}
            onExternal={() => void host.openExternal(doc.scopeId, doc.path).catch(onError)}
            onLink={(url) => void host.openUrl(url).catch(onError)}
          />
        ) : /\.csv$/i.test(path) && !target ? (
          <CsvPreview key={doc.hash} text={doc.text} />
        ) : (
          <PageEditor
            key={`${doc.hash}:${target?.n ?? 0}`}
            page={!doc.cloud && isPropertyPage(space, path)}
            properties={null}
            text={doc.text}
            mode={rich ? 'rich' : 'source'}
            filename={path}
            readOnly
            searchTarget={pending && (pending.search ?? lineTarget(doc.text, pending.line, rich))}
            onSearchResult={() => {
              applied.current = pending?.n;
            }}
            onChange={ignore}
            onFollowLink={onFollowLink}
            onError={onError}
            resolveImage={(url) => host.readImage(doc.scopeId, doc.path, url)}
          />
        )}
      </Suspense>
    </div>
  );
}
