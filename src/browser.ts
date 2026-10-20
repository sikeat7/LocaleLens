import type { BrowserOptions, Inspection } from './types.js';

/** These functions execute inside the inspected page. Keep them self-contained. */
export function transformPage(options: BrowserOptions): number {
  const skipped =
    'script,style,noscript,code,pre,kbd,samp,svg,math,textarea,select,option,[contenteditable]:not([contenteditable="false"]),[data-localelens-ignore]';
  const ignored = (element: Element): boolean =>
    !!element.closest(skipped) || options.ignore.some((selector) => !!element.closest(selector));

  // Fail early on bad selectors; a silent ignore typo would hide real findings.
  for (const selector of [...options.ignore, ...options.mask]) document.querySelector(selector);

  const isRtl = options.mode === 'rtl' || options.mode === 'expanded-rtl';
  if (isRtl) {
    document.documentElement.dir = 'rtl';
    if (document.body) document.body.dir = 'rtl';
  }
  let count = 0;
  if (options.mode === 'expanded' || options.mode === 'expanded-rtl') {
    const accents: Record<string, string> = {
      a: 'á',
      e: 'ë',
      i: 'ï',
      o: 'ö',
      u: 'ü',
      A: 'Á',
      E: 'Ë',
      I: 'Ï',
      O: 'Ö',
      U: 'Ü',
    };
    const walker = document.createTreeWalker(
      document.body ?? document.documentElement,
      NodeFilter.SHOW_TEXT,
    );
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const parent = node.parentElement;
      const original = node.textContent ?? '';
      if (
        !parent ||
        ignored(parent) ||
        !/[\p{L}]/u.test(original) ||
        !parent.getClientRects().length
      )
        continue;
      const style = getComputedStyle(parent);
      if (style.visibility !== 'visible' || style.display === 'none') continue;
      const body = original.trim();
      const accent = body.replace(/[aeiouAEIOU]/g, (char) => accents[char] ?? char);
      const padding = Math.ceil((Array.from(body).length * options.expansion) / 100);
      // Distribute padding within the text instead of creating one unbreakable suffix.
      const words = accent.split(/(\s+)/);
      const wordIndexes = words
        .map((word, index) => (/\S/.test(word) ? index : -1))
        .filter((index) => index >= 0);
      for (let i = 0; i < padding; i++) {
        const index = wordIndexes[i % wordIndexes.length];
        if (index !== undefined) words[index] += '~';
      }
      node.textContent = original.replace(body, words.join(''));
      count++;
    }
    // Button labels and text inputs also have user-facing placeholder text.
    for (const element of document.querySelectorAll<HTMLInputElement>(
      'input[placeholder],textarea[placeholder]',
    )) {
      if (ignored(element)) continue;
      const value = element.placeholder;
      if (!value) continue;
      element.placeholder = `${value}${'~'.repeat(Math.ceil((value.length * options.expansion) / 100))}`;
      count++;
    }
  }
  // Masks replace sensitive content before inspection as well as screenshots, keeping snippets private.
  // Fixed geometry preserves the original layout; descendants are hidden rather than removed.
  const maskStyle = document.createElement('style');
  maskStyle.textContent =
    '[data-localelens-masked]{color:transparent!important;text-shadow:none!important;background:#253348!important;overflow:hidden!important}[data-localelens-masked] *{visibility:hidden!important}';
  document.head.append(maskStyle);
  for (const selector of options.mask) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      element.setAttribute('data-localelens-masked', '');
    }
  }
  const style = document.createElement('style');
  style.textContent =
    '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}';
  document.head.append(style);
  return count;
}

export function inspectPage(options: BrowserOptions): Inspection {
  const findings: Inspection['findings'] = [];
  const notes: string[] = [];
  let omittedFindings = 0;
  const tolerance = 2;
  const viewportWidth = document.documentElement.clientWidth;
  const ignoreSelectors =
    '[data-localelens-ignore],[data-localelens-masked],script,style,noscript,svg,math';

  const ignored = (element: Element): boolean =>
    !!element.closest(ignoreSelectors) ||
    options.ignore.some((selector) => !!element.closest(selector));
  const visible = (element: Element): boolean => {
    if (!element.getClientRects().length || ignored(element)) return false;
    const style = getComputedStyle(element);
    return (
      style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) !== 0
    );
  };
  const selectorFor = (element: Element): string => {
    const chunks: string[] = [];
    let current: Element | null = element;
    for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) {
      if (current.id) {
        const idSelector = `#${CSS.escape(current.id)}`;
        if (document.querySelectorAll(idSelector).length === 1) {
          chunks.unshift(idSelector);
          break;
        }
      }
      const tag = current.tagName.toLowerCase();
      const parent: Element | null = current.parentElement;
      const siblings: Element[] = parent
        ? [...parent.children].filter((child) => child.tagName === current?.tagName)
        : [];
      const position = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
      chunks.unshift(`${tag}${position}`);
    }
    return chunks.join(' > ');
  };
  const rectFor = (element: Element) => {
    const box = element.getBoundingClientRect();
    return {
      x: Math.round(box.x + scrollX),
      y: Math.round(box.y + scrollY),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  };
  const snippet = (element: Element): string => {
    // Range text from unmasked descendants only. A masked subtree must never leak through its parent.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const values: string[] = [];
    while (walker.nextNode() && values.join('').length < 160) {
      const parent = walker.currentNode.parentElement;
      if (parent && !ignored(parent)) values.push(walker.currentNode.textContent ?? '');
    }
    return values.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  };
  const add = (finding: Inspection['findings'][number]) => {
    if (findings.length < options.maxFindings) findings.push(finding);
    else omittedFindings++;
  };
  const horizontal = options.checks.includes('horizontal-overflow');
  const clipping = options.checks.includes('clipped-text');
  const elements = [...document.querySelectorAll<HTMLElement>('body *')];
  const scanned = elements.slice(0, 20000);
  if (elements.length > scanned.length)
    notes.push('DOM inspection limited to the first 20,000 elements.');
  if (document.querySelector('iframe')) notes.push('Iframe contents are not inspected.');
  if (scanned.some((element) => !!element.shadowRoot))
    notes.push('Shadow DOM contents are not inspected.');
  const overflowElements = new Set<Element>();
  const suppressedByClipOrScroll = (element: Element, box: DOMRect): boolean => {
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
      const style = getComputedStyle(ancestor);
      if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) {
        const boundary = ancestor.getBoundingClientRect();
        // Content intentionally inside a carousel, scroller or clipped region isn't page overflow.
        if (boundary.left >= -tolerance && boundary.right <= viewportWidth + tolerance) return true;
        if (box.right < boundary.left || box.left > boundary.right) return true;
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  };

  for (const element of scanned) {
    if (!visible(element)) continue;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    if (horizontal && (box.right > viewportWidth + tolerance || box.left < -tolerance)) {
      const parentReported = [...overflowElements].some((parent) => parent.contains(element));
      if (!parentReported && !suppressedByClipOrScroll(element, box)) {
        overflowElements.add(element);
        add({
          code: 'horizontal-overflow',
          severity: 'error',
          message: `Element extends beyond the ${viewportWidth}px viewport by ${Math.ceil(Math.max(box.right - viewportWidth, -box.left))}px.`,
          suggestion:
            'Use flexible widths, min-width: 0 on flex/grid children, and wrapping text. Prefer logical CSS properties for RTL.',
          selector: selectorFor(element),
          text: snippet(element),
          rect: rectFor(element),
        });
      }
    }
    if (!clipping || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) continue;
    const style = getComputedStyle(element);
    const hasText = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (!hasText) continue;
    const horizontalClip =
      ['hidden', 'clip'].includes(style.overflowX) &&
      element.scrollWidth > element.clientWidth + tolerance;
    const verticalClip =
      ['hidden', 'clip'].includes(style.overflowY) &&
      element.scrollHeight > element.clientHeight + tolerance;
    if (horizontalClip || verticalClip) {
      const intentional =
        style.textOverflow === 'ellipsis' || !['none', '', '0'].includes(style.webkitLineClamp);
      if (intentional) continue;
      add({
        code: 'clipped-text',
        severity: 'warning',
        message: `Text appears clipped ${horizontalClip ? 'horizontally' : 'vertically'} inside its container.`,
        suggestion:
          'Allow wrapping or additional height. If truncation is intentional, use --ignore or data-localelens-ignore.',
        selector: selectorFor(element),
        text: snippet(element),
        rect: rectFor(element),
      });
    }
  }
  // A single long inline text node can overflow even when its parent's border box fits.
  const ignoredOverflow =
    horizontal &&
    scanned.some((element) => {
      if (!ignored(element)) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.right > viewportWidth + tolerance || box.left < -tolerance);
    });
  if (
    horizontal &&
    document.documentElement.scrollWidth > viewportWidth + tolerance &&
    overflowElements.size === 0 &&
    !ignoredOverflow
  ) {
    add({
      code: 'horizontal-overflow',
      severity: 'error',
      message: `The document is ${document.documentElement.scrollWidth}px wide at a ${viewportWidth}px viewport.`,
      suggestion:
        'Inspect long unbreakable text, pseudo-elements, and fixed-width containers. Use overflow-wrap where appropriate.',
      selector: 'html',
    });
  }
  return { findings, omittedFindings, notes };
}

export function annotatePage(
  items: { rect?: { x: number; y: number; width: number; height: number }; severity: string }[],
): void {
  const root = document.createElement('div');
  root.setAttribute('data-localelens-overlay', '');
  root.style.cssText =
    'position:absolute;inset:0;pointer-events:none;z-index:2147483647;contain:layout style;';
  items.forEach((item, index) => {
    if (!item.rect) return;
    const color = item.severity === 'error' ? '#e5484d' : '#d99720';
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${Math.max(0, item.rect.x)}px;top:${Math.max(0, item.rect.y)}px;width:${Math.max(2, item.rect.width)}px;height:${Math.max(2, item.rect.height)}px;outline:2px solid ${color};outline-offset:-2px;box-sizing:border-box;`;
    const label = document.createElement('span');
    label.textContent = String(index + 1);
    label.style.cssText = `position:absolute;top:0;left:0;padding:2px 5px;background:${color};color:#fff;font:700 11px/1.2 monospace;border-radius:0 0 4px 0;`;
    box.append(label);
    root.append(box);
  });
  document.body.append(root);
}
