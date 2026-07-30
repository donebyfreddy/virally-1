/**
 * Provenance is the enforcement mechanism against unattributed proof.
 *
 * A claim cannot be constructed without declaring where it came from, so a
 * real-looking figure with no source is a type error rather than a review
 * catch. Components read the discriminant to decide how to render:
 *
 *   verified       → may animate, may be presented as evidence
 *   internal-demo  → labelled as Virally's own output
 *   illustrative   → sample figures; must carry a visible disclosure
 *   placeholder    → unmistakable dev treatment; fails the production build
 */
export type Provenance =
  | {
      status: "verified";
      source: string;
      sourceUrl: string;
      asOf: `${number}-${number}-${number}`;
    }
  | { status: "internal-demo" }
  | { status: "illustrative" }
  | { status: "placeholder"; required: string };

export type ProvenanceStatus = Provenance["status"];

/** Only verified figures may count up. Animating a sample dresses it as proof. */
export function mayAnimate(provenance: Provenance): boolean {
  return provenance.status === "verified";
}

/** Sections containing these must render a visible disclosure. */
export function needsDisclosure(provenance: Provenance): boolean {
  return provenance.status === "illustrative" || provenance.status === "placeholder";
}

export const DISCLOSURE_ILLUSTRATIVE =
  "Illustrative sample data. Individual results vary.";

/**
 * Build guard. Placeholders are fine in development — they keep layout
 * reviewable — but must never reach production dressed as proof.
 */
export function assertNoPlaceholders(
  items: ReadonlyArray<{ id: string; provenance: Provenance }>,
  context: string,
): void {
  if (process.env.NODE_ENV !== "production") return;
  const offenders = items
    .filter((item) => item.provenance.status === "placeholder")
    .map((item) => item.id);
  if (offenders.length > 0) {
    throw new Error(
      `${context}: unresolved placeholders in a production build: ${offenders.join(", ")}`,
    );
  }
}
