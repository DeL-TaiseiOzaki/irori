import { t } from '../domain/i18n';

/**
 * An error's text for display. The host bridge carries `String(error)`, so a host
 * failure arrives as "Error: …" and would read "Error: Error: …" if stringified again.
 */
export const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^(?:Error: )+/, '');

/**
 * Advice first. A tool's own output, which the host appends after a blank line
 * with credentials removed, stays folded until someone needs it.
 */
export function ErrorMessage({ text, className }: { text: string; className?: string }) {
  const [advice, ...detail] = text.split('\n\n');
  return (
    <div className={['error-message', className].filter(Boolean).join(' ')} role="alert">
      <p>{advice}</p>
      {detail.length > 0 && (
        <details>
          <summary>{t('詳細', 'Details')}</summary>
          <pre>{detail.join('\n\n')}</pre>
        </details>
      )}
    </div>
  );
}
