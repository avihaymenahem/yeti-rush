/**
 * A full-screen page.
 *
 * The menus used to be cards: a fixed-width panel floating in the middle of a
 * dimmed screen, with everything scrolling *inside* it. That reads as a dialog,
 * and a dialog is a promise that there is not much in it - so the shop grew to
 * fourteen cards inside a 24rem box on a 20:9 phone, and Settings could not
 * take a credit line without tipping into a scrollbar.
 *
 * A page instead fills the screen and lets its body scroll under a header that
 * does not move. The title, the wallet and the way out stay put however far
 * down the player is, which is what a card could never do without pinning
 * something to a floating box that was already too small.
 *
 * Split out rather than repeated per screen: four screens each building their
 * own header is how the shop ended up with a close button and the other three
 * only had a Back at the very bottom.
 */

import type { ReactNode, RefObject } from 'react';
import { Icon } from '@/app/Icon';
import { NavIcons } from '@/app/icons';
import { TapButton } from '@/app/TapButton';

export interface PageProps {
  title: string;
  onClose: () => void;
  /** Sits left of the close button - the shop puts the coin balance here. */
  aside?: ReactNode;
  /** Under the title, above the scroll. For a subtitle or a row of tabs. */
  toolbar?: ReactNode;
  /**
   * The scrolling element, for a page that needs to move it itself.
   *
   * The shop switches tabs, and landing halfway down a shorter list because the
   * last one was longer reads as the page having jumped. Exposed as a ref
   * rather than a `scrollToTop` callback because the caller already knows when
   * it wants to scroll; it just cannot reach the element from outside.
   */
  bodyRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

export function Page({ title, onClose, aside, toolbar, bodyRef, children }: PageProps) {
  return (
    <div className="layer page">
      <header className="page-header">
        <h2 className="page-title">{title}</h2>
        <div className="page-actions">
          {aside}
          <TapButton className="panel-close" aria-label={`Close ${title}`} onTap={onClose}>
            <Icon icon={NavIcons.close} size={18} />
          </TapButton>
        </div>
      </header>

      {toolbar ? <div className="page-toolbar">{toolbar}</div> : null}

      {/* The only thing that scrolls. Keeping the header out of it is the whole
          point of the shell - a way out that scrolls away is a way out you have
          to go looking for. */}
      <div ref={bodyRef} className="page-body">
        {children}
      </div>
    </div>
  );
}
