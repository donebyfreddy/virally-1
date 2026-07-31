import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
// Imported from the directive-free style module, NOT from `./Button`. Button is
// a client component, and a server-rendered ButtonLink importing these strings
// through it receives client references that `cn()` drops — which silently
// rendered every ButtonLink on a server page as unstyled text.
import {
  buttonBase,
  buttonSizeClasses,
  variantClasses,
  type ButtonSize,
  type ButtonVariant,
} from "./buttonStyles";

type ButtonLinkProps = {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  className?: string;
  iconTrailing?: ReactNode;
} & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">;

// Shared with Button rather than duplicated, so an anchor styled as a button
// stays pixel-identical to one.
const sizeClasses = buttonSizeClasses;

/**
 * An anchor that looks like a button. Navigation must stay an `<a>` so
 * middle-click, copy-link and screen-reader link semantics all keep working —
 * a `<button>` with `router.push` breaks all three.
 */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  children,
  className,
  iconTrailing,
  // CTAs point across the app boundary (signup, login, sales). Prefetching
  // those wastes bandwidth for the majority who never click, and eagerly
  // fetches routes the marketing build does not own.
  prefetch = false,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(
        buttonBase,
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {children}
      {iconTrailing}
    </Link>
  );
}
