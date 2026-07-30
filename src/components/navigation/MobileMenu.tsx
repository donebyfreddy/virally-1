"use client";

import { useCallback, useEffect, useRef } from "react";
import { AnimatePresence, m } from "framer-motion";
import { ctas, navLinks } from "@/content/navigation";
import { Button } from "@/components/primitives/Button";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { duration, ease } from "@/lib/motion/tokens";
import { cn } from "@/lib/cn";

type MobileMenuProps = {
  open: boolean;
  onClose: () => void;
  /** Focus is returned here on every close path. */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';

export function MobileMenu({ open, onClose, triggerRef }: MobileMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Body scroll lock. The width compensation prevents the layout shifting when
   * the scrollbar disappears — otherwise opening the menu registers as CLS.
   */
  useEffect(() => {
    if (!open) return;
    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    // Restores on unmount too, so a route change or resize past the breakpoint
    // can never leave the page unscrollable.
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [open]);

  /** Close when the viewport grows past the breakpoint the menu exists for. */
  useEffect(() => {
    if (!open) return;
    const mql = window.matchMedia("(min-width: 64rem)");
    const onChange = () => mql.matches && onClose();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [open, onClose]);

  /** Move focus into the panel on open, restore it to the trigger on close. */
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const trigger = triggerRef.current;
    return () => trigger?.focus();
  }, [open, triggerRef]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Focus trap.
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <AnimatePresence>
      {open && (
        <m.div
          className="fixed inset-0 z-[var(--z-overlay)] lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.base, ease: ease.cut }}
        >
          <div
            className="absolute inset-0 bg-[var(--color-scrim)]"
            onClick={onClose}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            onKeyDown={handleKeyDown}
            className={cn(
              "absolute inset-x-0 top-0",
              "border-b border-[var(--color-border-hairline)] bg-[var(--color-surface-1)]",
              "px-[var(--gutter)] pb-8 pt-[var(--nav-height)]",
            )}
          >
            <div className="flex justify-end py-4">
              <Button variant="text" onClick={onClose} aria-label="Close menu">
                Close ✕
              </Button>
            </div>

            <nav aria-label="Primary">
              <ul className="flex flex-col">
                {navLinks.map((link) => (
                  <li key={link.id}>
                    <a
                      href={link.href}
                      onClick={onClose}
                      className={cn(
                        "flex min-h-11 items-center border-b border-[var(--color-border-hairline)] py-4",
                        "font-display text-[1.75rem] text-[color:var(--color-text-primary)]",
                      )}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="mt-8 flex flex-col gap-3">
              <ButtonLink href={ctas.primary.href} variant="primary" size="lg">
                {ctas.primary.label}
              </ButtonLink>
              <ButtonLink href={ctas.login.href} variant="secondary" size="lg">
                {ctas.login.label}
              </ButtonLink>
            </div>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
