import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  buttonBase,
  variantClasses,
  type ButtonSize,
  type ButtonVariant,
} from "./Button";

type ButtonLinkProps = {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  className?: string;
  iconTrailing?: ReactNode;
} & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">;

const sizeClasses: Record<ButtonSize, string> = {
  md: "px-4 py-2.5",
  lg: "px-6 py-3.5 text-[length:var(--text-body-s)]",
};

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
