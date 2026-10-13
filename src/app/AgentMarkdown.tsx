import { createContext, memo, useContext, useState, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { writtenPath } from '../domain/path-links';
import { usePathTarget } from './path-links';

const host = window.irori;

/** Inline code inside a link is part of that link, not a second one. */
const InLink = createContext(false);

/** A path the reply names, opened on the stage as the explorer would open it. */
function PathLink({
  target,
  open,
  children,
}: {
  target: { path: string; line?: number };
  open: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="message-link path-link"
      title={target.line ? `${target.path}:${target.line}` : target.path}
      onClick={open}
    >
      <InLink.Provider value={true}>{children}</InLink.Provider>
    </button>
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
      <PathLink target={path.target} open={path.open}>
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

function Code({ className, children }: { className?: string; children?: ReactNode }) {
  const inLink = useContext(InLink);
  // A code block's text ends with its line break; only inline code may be a path.
  const text = typeof children === 'string' && !className && !inLink ? children : undefined;
  const path = usePathTarget(text?.includes('\n') ? undefined : text, 'code');
  const code = <code className={className}>{children}</code>;
  return path ? (
    <PathLink target={path.target} open={path.open}>
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
    code: ({ className, children }) => <Code className={className}>{children}</Code>,
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
