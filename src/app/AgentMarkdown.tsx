import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Assistant replies are Markdown, and they are untrusted text. react-markdown
// builds React elements and never injects raw HTML; these overrides also keep the
// reply from reaching the network or navigating the application: a link shows its
// target instead of following it, and an image becomes its description.
const components: Components = {
  a: ({ href, children }) => (
    <span className="message-link" title={href}>
      {children}
    </span>
  ),
  img: ({ alt, src }) => <span className="message-image">{alt || String(src ?? '')}</span>,
};

export const AgentMarkdown = memo(function AgentMarkdown({ text }: { text: string }) {
  return (
    <div className="message-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
});
