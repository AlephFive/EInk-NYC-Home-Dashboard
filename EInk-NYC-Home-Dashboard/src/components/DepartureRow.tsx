/**
 * One departure line, shared by every transit type so rows are identical in
 * height and column positions across cards.
 *
 * Layout: [badge] [destination, flexible and clipped] [time, right-aligned].
 * The fixed ROW_HEIGHT is what keeps rows uniform — content never dictates it,
 * so a long destination or a two-character bullet cannot make one row taller
 * than its neighbours.
 */
const ROW_HEIGHT = 26;

export function EmptyRow({ label }: { label: string }) {
  return (
    <p
      style={{
        color: "#000",
        fontSize: "13px",
        fontWeight: "bold",
        margin: "4px 0 0 0",
      }}
    >
      {label}
    </p>
  );
}

export function DepartureRow({
  badge,
  badgeShape,
  point,
  badgeWidth,
  destination,
  time,
  urgent,
  leaveIn,
}: {
  badge: string;
  /** "bullet" = circular subway disc; "rect" = wider label for routes with names */
  badgeShape: "bullet" | "rect";
  /**
   * Shapes the badge into an arrow pointing this way, for routes where the
   * direction of travel matters. Omitted leaves the badge a plain rectangle.
   */
  point?: "left" | "right";
  /**
   * Fixed badge width, so every row in a list lines up rather than each badge
   * sizing to its own text. Callers compute it from the longest label present.
   */
  badgeWidth?: string;
  destination: string | null;
  time: string;
  urgent: boolean;
  /** Minutes until you should leave; omitted when the setting is off */
  leaveIn?: number;
}) {
  const fg = urgent ? "#fff" : "#000";
  const bg = urgent ? "#000" : "#fff";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "5px",
        height: `${ROW_HEIGHT}px`,
        minHeight: `${ROW_HEIGHT}px`,
        padding: "0 4px",
        boxSizing: "border-box",
        backgroundColor: bg,
        color: fg,
        borderLeft: `3px solid ${fg}`,
        borderRadius: "3px",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          // SI, the Staten Island Railway, is the only two-character bullet
          // in the system. At 11px it fits the 18px circle but crowds its
          // curve, so it steps down — the same treatment the TRMNL panel's
          // .bullet--pair gives it.
          ...(badgeShape === "bullet" && badge.length > 1
            ? { fontSize: "9px", letterSpacing: "-0.4px" }
            : { fontSize: "11px" }),
          fontWeight: "bold",
          backgroundColor: fg,
          color: bg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          whiteSpace: "nowrap",
          ...(badgeShape === "bullet"
            ? {
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                padding: 0,
              }
            : {
                // Rectangular label for named routes (bus, railroad branches),
                // capped so a long name cannot crowd out the destination.
                height: "18px",
                padding: "0 4px",
                ...(badgeWidth
                  ? { width: badgeWidth }
                  : { maxWidth: "76px" }),
                overflow: "hidden",
                // The badge ellipsizes even though the rest of the row clips
                // hard: a truncated branch name is easy to misread as a
                // different branch, so the cut is worth signalling here.
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "block",
                lineHeight: "18px",
                textAlign: "left",
                ...(point
                  ? {
                      // Cut the badge into an arrowhead so the direction of
                      // travel is the shape of the label, not a separate glyph
                      // competing with it for width. The three corners away
                      // from the point keep the same 2px radius as an
                      // unpointed badge; clip-path trims the rest.
                      borderRadius:
                        point === "right" ? "2px 0 0 2px" : "0 2px 2px 0",
                      // Both paddings clear the taper, so the label starts at
                      // the same x whichever way the badge points — otherwise
                      // the text jogs 5px across the column as the direction
                      // alternates row to row.
                      paddingLeft: "9px",
                      paddingRight: "9px",
                      clipPath:
                        point === "right"
                          ? "polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%)"
                          : "polygon(6px 0, 100% 0, 100% 100%, 6px 100%, 0 50%)",
                    }
                  : { borderRadius: "2px" }),
              }),
        }}
      >
        {badge}
      </span>

      {/* Destination takes the slack and is allowed to clip. It clips hard
          rather than ellipsizing: "..." costs about three characters of the
          very space it is reporting is short, and on a fixed panel a name cut
          mid-word still reads. */}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "12px",
          fontWeight: "bold",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textAlign: "left",
        }}
      >
        {destination ?? ""}
      </span>

      {leaveIn !== undefined && (
        <span
          style={{
            fontSize: "11px",
            fontWeight: "bold",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {leaveIn <= 0 ? "now" : `${leaveIn}m`}
        </span>
      )}

      <span
        style={{
          fontSize: "14px",
          fontWeight: "bold",
          flexShrink: 0,
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {time}
      </span>
    </div>
  );
}
