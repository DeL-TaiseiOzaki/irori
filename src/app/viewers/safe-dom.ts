/**
 * Office viewers turn a file's contents into markup. The page's CSP already refuses
 * scripts, frames and network loads; this also strips what a crafted file could use
 * to act rather than to show, so the viewer never depends on the CSP alone.
 */
const removed =
  'script,iframe,frame,object,embed,link,meta,base,form,input,button,textarea,select,template,animate,set,style';

const isAnchor = (element: Element) =>
  element instanceof HTMLAnchorElement || element instanceof SVGAElement;

function safeUrl(element: Element, name: string, value: string) {
  const url = value.trim();
  if (name === 'href') return isAnchor(element) && /^(https?:|mailto:|#)/i.test(url);
  return /^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(url) || url.startsWith('#');
}

export function neutralize(root: ParentNode) {
  for (const element of root.querySelectorAll(removed)) element.remove();
  for (const element of root.querySelectorAll('*')) {
    for (const { name, value } of [...element.attributes]) {
      const lower = name.toLowerCase();
      if (lower.startsWith('on') || lower === 'srcset' || lower === 'formaction')
        element.removeAttribute(name);
      else if (lower === 'style' && /url\s*\(|@import|expression\s*\(/i.test(value))
        element.removeAttribute(name);
      else if (
        ['href', 'src', 'xlink:href', 'action', 'poster', 'background'].includes(lower) &&
        !safeUrl(element, lower, value)
      )
        element.removeAttribute(name);
    }
    if (isAnchor(element)) element.removeAttribute('target');
  }
}

/** Keeps only inert `<style>` sheets inside a viewer's style container, stripping imports and external URLs. */
export function neutralizeStyles(container: ParentNode) {
  for (const child of [...container.childNodes]) {
    if (child instanceof HTMLStyleElement) {
      child.textContent = (child.textContent ?? '')
        .replace(/@import\b[^;]*;?/gi, '')
        .replace(
          /url\s*\(\s*(['"]?)\s*(?!data:image\/(?:png|jpe?g|gif|webp|bmp);)[^)]*\1\s*\)/gi,
          'none',
        );
    } else {
      child.remove();
    }
  }
}

/** Parses markup without running or loading anything, then neutralizes it. */
export function safeFragment(html: string) {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  neutralize(parsed.body);
  const fragment = document.createDocumentFragment();
  fragment.append(...[...parsed.body.childNodes].map((node) => document.importNode(node, true)));
  return fragment;
}

/**
 * A viewer's links open in the browser, as links in agent output do; every other click
 * on one is swallowed so the window never navigates away from irori.
 */
export function followLinks(root: HTMLElement | ShadowRoot, open: (url: string) => void) {
  const click = (event: Event) => {
    const link = (event.composedPath() as Element[]).find(
      (node): node is HTMLAnchorElement | SVGAElement =>
        node instanceof HTMLAnchorElement || node instanceof SVGAElement,
    );
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) open(href);
    else if (href.startsWith('#'))
      root.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView();
  };
  root.addEventListener('click', click);
  return () => root.removeEventListener('click', click);
}
