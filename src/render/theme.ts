/**
 * Canvas can't use CSS variables, so resolve the design tokens once for the
 * element a canvas lives in. Inside `.dark` this yields the dark ramp.
 */
export interface Theme {
  background: string;
  background07: string;
  background05: string;
  foreground: string;
  foreground07: string;
  foreground05: string;
  foreground03: string;
  accent: string;
  added: string;
  deleted: string;
  modified: string;
  fontSans: string;
  fontMono: string;
}

export function readTheme(el: Element): Theme {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: v('--background'),
    background07: v('--background-07'),
    background05: v('--background-05'),
    foreground: v('--foreground'),
    foreground07: v('--foreground-07'),
    foreground05: v('--foreground-05'),
    foreground03: v('--foreground-03'),
    accent: v('--brand-text'),
    added: v('--diff-added'),
    deleted: v('--diff-deleted'),
    modified: v('--diff-modified'),
    fontSans: v('--font-sans-stack'),
    fontMono: v('--font-mono-stack'),
  };
}
