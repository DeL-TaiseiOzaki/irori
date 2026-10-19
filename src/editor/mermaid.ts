import type { MermaidConfig } from 'mermaid';
import { t } from '../domain/i18n';

/** Mermaid is large, so it loads the first time a note shows a diagram. */
let loading: Promise<typeof import('mermaid').default> | undefined;
let diagrams = 0;

/** The diagram colours follow irori's theme, read when each diagram is drawn. */
function config(): MermaidConfig {
  // The page is light in every theme but the dark one.
  const dark = document.documentElement.dataset.theme === 'dark';
  return {
    startOnLoad: false,
    // Labels stay text, scripts and clicks are dropped (Mermaid's strict level).
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'neutral',
    fontFamily: getComputedStyle(document.body).fontFamily,
  };
}

/**
 * A fenced `mermaid` block's preview: its diagram as SVG, drawn once Mermaid has
 * loaded, or what is wrong with it. Crepe sanitizes what is handed back.
 */
export function mermaidPreview(
  content: string,
  apply: (value: null | string | HTMLElement) => void,
): void {
  if (!content.trim()) return apply(null);
  loading ??= import('mermaid').then((module) => module.default);
  void loading
    .then(async (mermaid) => {
      mermaid.initialize(config());
      const { svg } = await mermaid.render(`irori-mermaid-${++diagrams}`, content);
      apply(svg);
    })
    .catch((error: unknown) => {
      const problem = document.createElement('p');
      problem.className = 'mermaid-error';
      problem.textContent = t(
        `図を描けません: ${error instanceof Error ? error.message : String(error)}`,
        `Cannot draw the diagram: ${error instanceof Error ? error.message : String(error)}`,
      );
      apply(problem);
    });
}
