"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { STUDIOS } from "@/content/generate";

/**
 * The capability nav shared by every generation route.
 *
 * A client component for one reason — `usePathname`, to mark the current
 * studio. Everything else about the shell stays on the server.
 *
 * `aria-current="page"` rather than colour alone, so the active tab survives
 * being read without hue, and the rail is a real list of links: middle-click,
 * copy-link and back all behave.
 */
const OVERVIEW = { href: "/app/generate", label: "Overview" } as const;

export function StudioNav() {
  const pathname = usePathname();

  const items = [OVERVIEW, ...STUDIOS.map((studio) => ({ href: studio.href, label: studio.label }))];

  return (
    <nav aria-label="Generation studios">
      <ul
        className={cn(
          "flex flex-wrap items-center gap-1 rounded-[var(--radius-control)]",
          "border border-[var(--border-default)] bg-[var(--surface-primary)] p-1",
        )}
      >
        {items.map((item) => {
          const current = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center rounded-[var(--radius-chip)] px-3",
                  "text-[length:var(--text-app-cell)] font-[var(--weight-strong)]",
                  "transition-colors duration-[var(--dur-instant)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)]",
                  current
                    ? "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]"
                    : "text-[color:var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
