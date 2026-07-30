import { Wordmark } from "@/components/navigation/Wordmark";
import { navLinks } from "@/content/navigation";
import { SectionContainer } from "@/components/motion/MotionSection";
import { cn } from "@/lib/cn";

const legalLinks = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Security", href: "/security" },
  { label: "Platform policies", href: "/platform-policies" },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-[var(--color-border-hairline)] py-16">
      <SectionContainer>
        <div className="flex flex-col gap-12 md:flex-row md:justify-between">
          <div className="flex flex-col gap-4">
            <Wordmark />
            <p
              className={cn(
                "max-w-[var(--measure-narrow)]",
                "text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]",
              )}
            >
              An operating system for multi-platform content. Plan, create,
              adapt and distribute from one brief.
            </p>
          </div>

          <div className="flex gap-16">
            <nav aria-label="Sections">
              <ul className="flex flex-col gap-3">
                {navLinks.map((link) => (
                  <li key={link.id}>
                    <a
                      href={link.href}
                      className={cn(
                        "inline-flex min-h-11 items-center",
                        "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
                        "text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]",
                      )}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-label="Legal">
              <ul className="flex flex-col gap-3">
                {legalLinks.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className={cn(
                        "inline-flex min-h-11 items-center",
                        "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
                        "text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]",
                      )}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>

        <p
          className={cn(
            "mt-16 border-t border-[var(--color-border-hairline)] pt-8",
            "font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]",
          )}
        >
          Virally increases the speed and volume of creative experimentation. It
          does not guarantee reach, growth or virality.
        </p>
      </SectionContainer>
    </footer>
  );
}
