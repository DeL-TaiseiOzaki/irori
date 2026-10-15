import { createContext, memo, useContext, useState, type ReactNode } from 'react';
import { t } from '../domain/i18n';
import type { PathTarget } from '../domain/path-links';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { writtenPath } from '../domain/path-links';
import { usePathTarget, type PathLinkTarget } from './path-links';

const host = window.irori;

/** Inline code inside a link is part of that link, not a second one. */
const InLink = createContext(false);

/**
 * A path the reply names, opened on the stage as the explorer would open it.
 * The host finds the file when it is clicked, where the writer works first
 * (ADR 044); a name in several places offers each of them.
 */
function PathLink({
  link,
  onError,
  children,
}: {
  link: PathLinkTarget;
  onError: (error: unknown) => void;
  children: ReactNode;
}) {
  const [choices, setChoices] = useState<PathTarget[]>([]);
  const [finding, setFinding] = useState(false);
  const { written } = link;
  const where = (target: PathTarget) => `${link.name(target.scopeId)}: ${target.path}`;
  return (
    <>
      <button
        type="button"
        className="message-link path-link"
        title={
          link.target
            ? where(link.target)
            : written.line
              ? `${written.path}:${written.line}`
              : written.path
        }
        aria-busy={finding || undefined}
        onClick={() => {
          setFinding(true);
          setChoices([]);
          void link
            .find()
            .then((found) => {
              if (found.length === 1) link.open(found[0]);
              else if (found.length > 1) setChoices(found);
              else
                onError(t(`${written.path} が見つかりません。`, `${written.path} was not found.`));
            }, onError)
            .finally(() => setFinding(false));
        }}
      >
        <InLink.Provider value={true}>{children}</InLink.Provider>
      </button>
      {choices.length > 0 && (
        <span className="path-choices" role="group" aria-label={t('開くファイル', 'File to open')}>
          {choices.map((choice) => (
            <button
              key={`${choice.scopeId}/${choice.path}`}
              type="button"
              className="message-link path-link"
              onClick={() => {
                setChoices([]);
                link.open(choice);
              }}
            >
              {where(choice)}
            </button>
          ))}
        </span>
      )}
    </>
  );
}

function Link({
  href,
  children,
  onError,
}: {
  href?: string;
  children: ReactNode;
  onError: (error: unknown) => void;
}) {
  const path = usePathTarget(href, 'href');
  if (path)
    return (
      <PathLink link={path} onError={onError}>
        {children}
      </PathLink>
    );
  return (
    <a
      className="message-link"
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault();
        if (href) void host.openUrl(href).catch(onError);
      }}
    >
      <InLink.Provider value={true}>{children}</InLink.Provider>
    </a>
  );
}

function Code({
  className,
  children,
  onError,
}: {
  className?: string;
  children?: ReactNode;
  onError: (error: unknown) => void;
}) {
  const inLink = useContext(InLink);
  // A code block's text ends with its line break; only inline code may be a path.
  const text = typeof children === 'string' && !className && !inLink ? children : undefined;
  const path = usePathTarget(text?.includes('\n') ? undefined : text, 'code');
  const code = <code className={className}>{children}</code>;
  return path ? (
    <PathLink link={path} onError={onError}>
      {code}
    </PathLink>
  ) : (
    code
  );
}

// Assistant replies are Markdown, and they are untrusted text. react-markdown
// builds React elements and never injects raw HTML. The overrides keep what is
// left under control: a link is handed to the host, which opens ordinary web
// addresses in the user's browser and refuses every other scheme, and an image
// becomes its description rather than a request the reply gets to make. A link
// or inline code naming a file of a vault in the workspace opens that file on
// the stage, as Claude Code and Codex do in VS Code.
function markdownComponents(onError: (error: unknown) => void): Components {
  return {
    a: ({ href, children }) => (
      <Link href={href} onError={onError}>
        {children}
      </Link>
    ),
    code: ({ className, children }) => (
      <Code className={className} onError={onError}>
        {children}
      </Code>
    ),
    img: ({ alt, src }) => <span className="message-image">{alt || String(src ?? '')}</span>,
  };
}

/** A file's path (`C:\x.md`, `file:///x.md`) reaches the link as written; anything else is sanitised. */
function urlTransform(url: string, key: string) {
  return key === 'href' && writtenPath(url, 'href') ? url : defaultUrlTransform(url);
}

export const AgentMarkdown = memo(function AgentMarkdown({ text }: { text: string }) {
  const [error, setError] = useState('');
  const [components] = useState(() => markdownComponents((value) => setError(String(value))));
  return (
    <div className="message-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {text}
      </Markdown>
      {error && (
        <p className="message-link-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
