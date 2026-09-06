/**
 * How many departure rows fit in a card, computed from the layout rather than
 * measured.
 *
 * The panel renders once and is screenshotted, so there is no second pass in
 * which a measured value could settle — every number here is therefore derived
 * from the fixed geometry the layout already commits to. The trade is that
 * these constants must track the styles they mirror; they are named and
 * gathered here so a redesign has one place to update.
 */

/** Outer panel, matching the root box in App.tsx. */
const PANEL_HEIGHT = 480;
const PANEL_BORDER = 2;
const PANEL_PADDING = 6;

/** Gap between stacked cards in a column (App.tsx column style). */
const CARD_GAP = 6;

/** `.card` padding, from App.css (0.5em at the 14px root = 7px each side). */
const CARD_PADDING = 7;

/** Header block: fixed height plus its margin-bottom (TransitCard.tsx). */
const HEADER_BLOCK = 34 + 4;

/** A direction/column subheading: 13px line plus its 4px margin. */
const SUBHEADING_BLOCK = 20;

/** One departure row plus the 3px gap beneath it (App.tsx listStyle). */
const ROW_BLOCK = 26 + 3;

/** The list's own margin-top (App.tsx listStyle). */
const LIST_MARGIN = 4;

/**
 * The "Last updated" line is absolutely positioned over the board's
 * bottom-right, so it overlaps whatever card ends there. Cards in that corner
 * stop short of it rather than running underneath.
 */
const FOOTER_RESERVE = 27;

/**
 * Rows that fit in one card of a column holding `cardsInColumn` cards.
 *
 * @param cardsInColumn - How many cards share the column (1 or 2)
 * @param hasSubheading - Whether the card renders a direction/column heading
 * @param abutsFooter - Whether this card sits in the board's bottom-right,
 *   where the "Last updated" line is drawn over it
 * @returns Number of departure rows that fit, at least 1
 */
export function departuresForCard(
  cardsInColumn: number,
  hasSubheading: boolean,
  abutsFooter = false
): number {
  const usable = PANEL_HEIGHT - 2 * PANEL_BORDER - 2 * PANEL_PADDING;
  const cardHeight =
    (usable - CARD_GAP * (cardsInColumn - 1)) / cardsInColumn;

  const available =
    cardHeight -
    2 * CARD_PADDING -
    HEADER_BLOCK -
    (hasSubheading ? SUBHEADING_BLOCK : 0) -
    LIST_MARGIN -
    (abutsFooter ? FOOTER_RESERVE : 0);

  // The final row needs no trailing gap, so one gap is credited back.
  return Math.max(1, Math.floor((available + 3) / ROW_BLOCK));
}
