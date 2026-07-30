import Link from "next/link";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { Wordmark } from "@/components/navigation/Wordmark";

/**
 * Placeholder destinations for the CTAs.
 *
 * The marketing site owns these hrefs but not the product application, so
 * these routes exist purely so a CTA never lands on a 404. They deliberately
 * contain no form fields — a decorative sign-up or login form would collect
 * credentials under false pretences and mislead visitors about what is built.
 */
export function PlaceholderRoute({
  eyebrow,
  heading,
  body,
}: {
  eyebrow: string;
  heading: string;
  body: string;
}) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-[var(--container-text)] flex-col justify-center px-[var(--gutter)] py-24"
    >
      <Link href="/" className="mb-16 inline-flex w-fit min-h-11 items-center">
        <Wordmark />
      </Link>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="font-display mt-4 text-[length:var(--text-display-m)]">
        {heading}
      </h1>
      <p className="prose-measure mt-6 text-[color:var(--color-text-secondary)]">{body}</p>
      <div className="mt-12">
        <ButtonLink href="/" variant="secondary">
          Back to the site
        </ButtonLink>
      </div>
    </main>
  );
}
