import { isPropertyPage } from '../domain/scopes';
import type { Space } from '../domain/types';
import { useResource } from './useResource';
import { PageEditor } from './PageEditor';
import { CsvPreview } from './CsvPreview';
import { FileViewer } from './FileViewer';

const host = window.irori;
const ignore = () => {};

/**
 * The file on show in a stage column without the focus (ADR 052): read from the
 * vault and shown as the editor would, without editing. It is read again when the
 * vault's files change, so a save in the focused column shows here too.
 */
export function StagePreview({
  space,
  path,
  revision,
  onError,
}: {
  space: Space;
  path: string;
  revision: number;
  onError: (error: unknown) => void;
}) {
  const read = useResource(() => host.read(space.scopeId, path), [space.scopeId, path], {
    refresh: revision,
  });
  const doc = read.data;
  if (!doc)
    return read.error ? (
      <p className="hint" role="status">
        {read.error}
      </p>
    ) : null;
  return (
    <div className="document-scroll">
      {doc.viewer ? (
        <FileViewer
          key={doc.hash}
          doc={{ ...doc, viewer: doc.viewer }}
          load={(scopeId, file) => host.viewerBytes(scopeId, file)}
          onExternal={() => void host.openExternal(doc.scopeId, doc.path).catch(onError)}
          onLink={(url) => void host.openUrl(url).catch(onError)}
        />
      ) : /\.csv$/i.test(path) ? (
        <CsvPreview key={doc.hash} text={doc.text} />
      ) : (
        <PageEditor
          key={doc.hash}
          page={!doc.cloud && isPropertyPage(space, path)}
          properties={null}
          text={doc.text}
          mode={/\.md$/i.test(path) ? 'rich' : 'source'}
          filename={path}
          readOnly
          onChange={ignore}
          onError={onError}
          resolveImage={(url) => host.readImage(doc.scopeId, doc.path, url)}
        />
      )}
    </div>
  );
}
