import { ArrowLeft, Hammer } from "lucide-react";
import { AppPage } from "@/components/app-ui/AppPage";
import { Card, CardBody, CardHeader } from "@/components/app-ui/Card";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { notBuiltCopy } from "@/content/app-navigation";

/**
 * Placeholder for a navigable route whose phase has not shipped.
 *
 * States the gap rather than mocking the surface. A fake chart here would be worse
 * than an empty page, because it would imply data exists — and this product's whole
 * trust position rests on never showing a number it did not measure.
 *
 * Sized like an empty state rather than like a page: this is a dead end, and giving
 * it a 44px display headline made it the most emphatic screen in the product.
 */
export function NotBuiltYet({
  label,
  phase,
  /** What the surface will do, so the page is informative rather than a dead end. */
  planned,
}: {
  label: string;
  phase: number;
  planned: readonly string[];
}) {
  return (
    <AppPage width="text">
      <Card>
        <CardHeader
          as="h1"
          title={notBuiltCopy.heading(label)}
          description={notBuiltCopy.body(phase)}
          action={
            <span className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-chip)] bg-[var(--surface-muted)] px-2 py-1 text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-secondary)]">
              <Hammer aria-hidden="true" size={12} strokeWidth={2} />
              Phase {phase}
            </span>
          }
          divided
        />

        <CardBody>
          <h2 className="app-label">What this surface will do</h2>
          <ul className="mt-[var(--space-3)] flex flex-col gap-[var(--space-2)]">
            {planned.map((item) => (
              <li
                key={item}
                className="flex gap-[var(--space-2)] text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]"
              >
                <span aria-hidden="true" className="text-[color:var(--brand-mark)]">
                  ·
                </span>
                {item}
              </li>
            ))}
          </ul>

          <div className="mt-[var(--space-5)]">
            <ButtonLink href="/app" variant="secondary">
              <ArrowLeft aria-hidden="true" size={15} strokeWidth={2} />
              Back to overview
            </ButtonLink>
          </div>
        </CardBody>
      </Card>
    </AppPage>
  );
}
