export type NavLink = {
  id: string;
  label: string;
  href: string;
};

export const navLinks: readonly NavLink[] = [
  { id: "product", label: "Product", href: "#product" },
  { id: "workflow", label: "Workflow", href: "#workflow" },
  { id: "formats", label: "Formats", href: "#formats" },
  { id: "channels", label: "Channels", href: "#channels" },
  { id: "results", label: "Results", href: "#results" },
  { id: "pricing", label: "Pricing", href: "#pricing" },
] as const;

/**
 * One primary CTA across the entire site. Competing primary actions are the
 * fastest way to lower conversion, so `Start creating` is the only amber
 * button anywhere.
 */
export const ctas = {
  primary: { label: "Start creating", href: "/app" },
  secondary: { label: "Watch the workflow", href: "#workflow" },
  login: { label: "Log in", href: "/auth/sign-in" },
  sales: { label: "Talk to sales", href: "/contact-sales" },
} as const;
