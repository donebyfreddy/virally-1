import Link from "next/link";
import type { ReactNode } from "react";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { Wordmark } from "@/components/navigation/Wordmark";
import { legalNote } from "@/content/auth";
import { PipelinePreview } from "./PipelinePreview";

/**
 * The authentication layout.
 *
 * Deliberately an asymmetric two-column split, not a centred card on an empty
 * page. The left column is a real form column at a readable measure; the right
 * is the pipeline structure the account is for. On mobile the right column is
 * dropped entirely rather than stacked — a decorative panel above the fold
 * would push the form itself off-screen.
 */
export function AuthShell({
  eyebrow,
  heading,
  body,
  children,
  footer,
  showLegal = false,
}: {
  eyebrow: string;
  heading: string;
  body: string;
  children: ReactNode;
  footer?: ReactNode;
  showLegal?: boolean;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main
        id="main"
        className="flex flex-col px-[var(--gutter)] py-12 lg:px-[var(--space-16)] lg:py-16"
      >
        <Link
          href="/"
          className={
            "inline-flex w-fit min-h-11 items-center rounded-[var(--radius-sm)] " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          }
        >
          <Wordmark />
          <span className="sr-only">Virally — back to the site</span>
        </Link>

        <div className="flex flex-1 flex-col justify-center py-12">
          <div className="w-full max-w-[26rem]">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1 className="font-display mt-3 text-[length:var(--text-display-m)] leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
              {heading}
            </h1>
            <p className="mt-4 max-w-[var(--measure-narrow)] text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
              {body}
            </p>

            <div className="mt-10">{children}</div>

            {showLegal && (
              <p className="mt-8 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
                {legalNote.prefix}{" "}
                <LegalLink href={legalNote.termsHref}>
                  {legalNote.termsLabel}
                </LegalLink>{" "}
                {legalNote.conjunction}{" "}
                <LegalLink href={legalNote.privacyHref}>
                  {legalNote.privacyLabel}
                </LegalLink>
                .
              </p>
            )}

            {footer && <div className="mt-8">{footer}</div>}
          </div>
        </div>
      </main>

      {/* Hidden below `lg` rather than reflowed: see the component note. */}
      <aside className="hidden border-l border-[var(--color-border-hairline)] bg-[var(--color-surface-1)] lg:block">
        <PipelinePreview />
      </aside>
    </div>
  );
}

/**
 * A link inside a sentence.
 *
 * Marked `data-inline-link` so the 44px touch-target assertion can exclude it.
 * WCAG 2.5.8 exempts targets "in a sentence or block of text" precisely because
 * padding one to 44px would break the line box it lives in. Every *control* on
 * the page still meets the floor — this attribute is not a general opt-out and
 * must never be added to a button.
 */
function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      data-inline-link="true"
      // Most visitors never open the legal pages; prefetching both on every
      // sign-up view is wasted bandwidth on the product's most latency-sensitive
      // screen.
      prefetch={false}
      className={
        "underline decoration-[var(--color-border-strong)] underline-offset-4 " +
        "text-[color:var(--color-text-secondary)] transition-colors " +
        "duration-[var(--dur-instant)] hover:text-[color:var(--color-text-primary)] " +
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
      }
    >
      {children}
    </Link>
  );
}

/** The `Prompt → Link` pair under each form. */
export function AuthAlternate({
  prompt,
  label,
  href,
}: {
  prompt: string;
  label: string;
  href: string;
}) {
  return (
    <p className="text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
      {prompt}{" "}
      <Link
        href={href}
        className={
          "inline-flex min-h-11 items-center font-utility text-[length:var(--text-utility)] " +
          "uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-action)] " +
          "underline decoration-[var(--color-action)] underline-offset-4 " +
          "transition-colors duration-[var(--dur-instant)] " +
          "hover:text-[color:var(--color-action-hover)] " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        }
      >
        {label}
      </Link>
    </p>
  );
}
