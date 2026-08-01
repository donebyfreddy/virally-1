import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Virally admin",
  robots: { index: false, follow: false },
};

/**
 * Compatibility entry for the product's former/internal “admin” name.
 *
 * The authenticated application is canonically routed under `/app`. Keeping
 * this thin redirect means old bookmarks and the product brief's `/admin`
 * vocabulary land on the same permission-protected implementation instead of
 * creating a second route tree that can drift from it.
 */
export default async function AdminAlias({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ path = [] }, query] = await Promise.all([params, searchParams]);
  const nextQuery = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) nextQuery.append(key, item);
    } else if (value !== undefined) {
      nextQuery.set(key, value);
    }
  }

  const suffix = path.length > 0 ? `/${path.map(encodeURIComponent).join("/")}` : "";
  const queryString = nextQuery.toString();
  redirect(`/app${suffix}${queryString ? `?${queryString}` : ""}`);
}
