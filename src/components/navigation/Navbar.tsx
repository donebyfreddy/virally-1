"use client";

import { useEffect, useRef, useState } from "react";
import { ctas, navLinks } from "@/content/navigation";
import { Button } from "@/components/primitives/Button";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { ScrollProgress } from "@/components/motion/ScrollProgress";
import { Wordmark } from "./Wordmark";
import { MobileMenu } from "./MobileMenu";
import { cn } from "@/lib/cn";

/**
 * Sticky compact navbar.
 *
 * Transparent over the hero, then gains a surface and hairline after 80px.
 * The transition animates colour only — height and padding are fixed, so the
 * state change contributes exactly zero CLS. The primary CTA is present from
 * first paint rather than appearing on scroll, for the same reason.
 */
export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // A rAF-throttled listener rather than a per-frame state write.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrolled((prev) => {
          const next = window.scrollY > 80;
          return prev === next ? prev : next;
        });
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-[var(--z-nav)]",
          "h-[var(--nav-height)]",
          "border-b transition-colors duration-[var(--dur-base)] ease-[var(--ease-cut)]",
          scrolled
            ? "border-[var(--color-border-hairline)] bg-[var(--color-canvas)]/92 backdrop-blur-sm"
            : "border-transparent bg-transparent",
        )}
      >
        <div
          className={cn(
            "mx-auto flex h-full max-w-[var(--container-max)] items-center justify-between",
            "px-[var(--gutter)]",
          )}
        >
          <a
            href="#main"
            className="inline-flex min-h-11 items-center"
            aria-label="Virally, back to top"
          >
            <Wordmark />
          </a>

          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {navLinks.map((link) => (
                <li key={link.id}>
                  <a
                    href={link.href}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-[var(--radius-sm)] px-3",
                      "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
                      "text-[color:var(--color-text-secondary)]",
                      "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
                      "hover:text-[color:var(--color-text-primary)]",
                    )}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <ButtonLink
              href={ctas.login.href}
              variant="text"
              className="hidden sm:inline-flex"
            >
              {ctas.login.label}
            </ButtonLink>
            <ButtonLink href={ctas.primary.href} variant="primary">
              {ctas.primary.label}
            </ButtonLink>
            <Button
              ref={triggerRef}
              variant="secondary"
              className="lg:hidden"
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              aria-label="Open menu"
              onClick={() => setMenuOpen(true)}
            >
              <span aria-hidden="true">☰</span>
            </Button>
          </div>
        </div>

        {/* Mobile progress indicator — the desktop status rail's collapsed form. */}
        <ScrollProgress className="h-0.5 w-full origin-left bg-[var(--color-action)] lg:hidden" />
      </header>

      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        triggerRef={triggerRef}
      />
    </>
  );
}
