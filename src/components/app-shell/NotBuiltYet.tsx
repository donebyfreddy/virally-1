import { Eyebrow, Rule } from "@/components/primitives/Eyebrow";
import { Badge } from "@/components/primitives/Badge";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { notBuiltCopy } from "@/content/app-navigation";

/**
 * Placeholder for a navigable route whose phase has not shipped.
 *
 * States the gap rather than mocking the surface. The brief is explicit that static
 * dashboard mockups are not acceptable output — a fake chart here would be worse
 * than an empty page, because it would imply data exists.
 */
export function NotBuiltYet({
  label,
  phase,
  planned,
}: {
  label: string;
  phase: number;
  /** What the surface will do, so the page is informative rather than a dead end. */
  planned: readonly string[];
}) {
  return (
    <div className="mx-auto w-full max-w-[var(--container-wide)] px-[var(--gutter)] py-16">
      <div className="flex flex-wrap items-center gap-3">
        <Eyebrow>{notBuiltCopy.eyebrow}</Eyebrow>
        <Badge tone="warning">PHASE {phase}</Badge>
      </div>

      <h1 className="font-display mt-3 text-[length:var(--text-display-m)]">
        {notBuiltCopy.heading(label)}
      </h1>
      <p className="prose-measure mt-4 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
        {notBuiltCopy.body(phase)}
      </p>

      <Rule className="my-10" />

      <h2 className="font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-secondary)]">
        What this surface will do
      </h2>
      <ul className="mt-4 flex max-w-[var(--measure-prose)] flex-col gap-2">
        {planned.map((item) => (
          <li
            key={item}
            className="flex gap-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]"
          >
            <span aria-hidden="true">·</span>
            {item}
          </li>
        ))}
      </ul>

      <div className="mt-10">
        <ButtonLink href="/app" variant="secondary">
          Back to overview
        </ButtonLink>
      </div>
    </div>
  );
}
