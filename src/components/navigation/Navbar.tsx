"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { ctas, navLinks } from "@/content/navigation";
import { fontPoppins } from "@/lib/fonts";
import { cn } from "@/lib/cn";
import { Wordmark } from "./Wordmark";

const navCta = cn(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4",
  "text-sm font-medium transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
);

/**
 * Always-translucent black header, no scroll-triggered state — the design
 * this replaces. `h-[var(--nav-height)]` keeps it byte-for-byte the same
 * height `<main>`'s top padding already reserves, so swapping it in costs no
 * extra CLS.
 */
export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  return (
    <header
      className={cn(
        fontPoppins.className,
        "fixed inset-x-0 top-0 z-[var(--z-nav)] h-[var(--nav-height)]",
        "border-b border-gray-800/50 bg-black/80 backdrop-blur-md",
      )}
    >
      <div className="relative mx-auto flex h-full max-w-[var(--container-max)] items-center justify-between px-[var(--gutter)]">
        <a href="#main" aria-label="Virally, back to top" className="inline-flex min-h-11 items-center">
          <Wordmark />
        </a>

        <nav
          aria-label="Primary"
          className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block"
        >
          <ul className="flex items-center gap-8">
            {navLinks.map((link) => (
              <li key={link.id}>
                <a
                  href={link.href}
                  className="inline-flex min-h-11 items-center text-sm text-white/60 transition-colors hover:text-white"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link href={ctas.login.href} className={cn(navCta, "text-white/80 hover:bg-white/5 hover:text-white")}>
            {ctas.login.label}
          </Link>
          <Link href={ctas.primary.href} className={cn(navCta, "bg-white text-black hover:bg-gray-100")}>
            {ctas.primary.label}
          </Link>
        </div>

        <button
          ref={triggerRef}
          type="button"
          className="relative inline-flex min-h-11 min-w-11 items-center justify-center text-white lg:hidden"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-nav-panel"
          aria-label="Toggle menu"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div
          id="mobile-nav-panel"
          className="border-t border-gray-800/50 bg-black lg:hidden"
        >
          <div className="flex flex-col gap-4 px-[var(--gutter)] py-4">
            {navLinks.map((link) => (
              <a
                key={link.id}
                href={link.href}
                className="flex min-h-11 items-center text-sm text-white/60 transition-colors hover:text-white"
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="flex flex-col gap-2 border-t border-gray-800/50 pt-4">
              <Link
                href={ctas.login.href}
                className={cn(navCta, "justify-center text-white/80 hover:bg-white/5 hover:text-white")}
                onClick={() => setMobileMenuOpen(false)}
              >
                {ctas.login.label}
              </Link>
              <Link
                href={ctas.primary.href}
                className={cn(navCta, "justify-center bg-white text-black hover:bg-gray-100")}
                onClick={() => setMobileMenuOpen(false)}
              >
                {ctas.primary.label}
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
