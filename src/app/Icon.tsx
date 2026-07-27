/**
 * The `Icon` wrapper.
 *
 * Split from `icons.ts` purely so this file exports a component and nothing
 * else - mixing components and plain values in one module breaks fast refresh.
 * The glyph tables live next door.
 */

import type { LucideIcon } from 'lucide-react';

export interface IconProps {
  icon: LucideIcon;
  /** Pixel size. Icons are square and drawn on the text colour. */
  size?: number;
  className?: string;
}

/**
 * Renders an icon at a size that matches the text beside it.
 *
 * `aria-hidden` throughout: every icon here sits next to its own label or on a
 * control that already carries an `aria-label`, so announcing it again would
 * read the same thing twice.
 */
export function Icon({ icon: Glyph, size = 20, className }: IconProps) {
  return (
    <Glyph
      className={className}
      size={size}
      strokeWidth={2.25}
      absoluteStrokeWidth
      aria-hidden="true"
      focusable="false"
    />
  );
}
