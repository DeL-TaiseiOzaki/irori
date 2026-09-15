import { memo, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const host = window.irori;

// Assistant replies are Markdown, and they are untrusted text. react-markdown
// builds React elements and never injects raw HTML. The overrides keep what is
// left under control: a link is handed to the host, which opens ordinary web
// addresses in the user's browser and refuses every other scheme, and an image
// becomes its description rather than a request the reply gets to make.
function markdownComponents(onError: (error: unknown) => void): Components {
  return {
    a: ({ href, children }) => (
      <a
        className="message-link"
        href={href}
        title={href}
        onClick={(event) => {
          event.preventDefault();
          if (href) void host.openUrl(href).catch(onError);
        }}
      >
        {children}
      </a>
    ),
    img: ({ alt, src }) => <span className="message-image">{alt || String(src ?? '')}</span>,
  };
}

export const AgentMarkdown = memo(function AgentMarkdown({ text }: { text: string }) {
  const [error, setError] = useState('');
  const [components] = useState(() => markdownComponents((value) => setError(String(value))));
  return (
    <div className="message-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
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
