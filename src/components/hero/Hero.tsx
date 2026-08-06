import Link from "next/link";
import { hero } from "@/content/marketing";
import { fontPoppins } from "@/lib/fonts";
import { cn } from "@/lib/cn";

const heroCta = cn(
  "inline-flex h-12 items-center justify-center gap-2 rounded-lg px-8",
  "text-base font-medium transition-all",
);

/**
 * S1 — static replacement for the previous orchestrated demo. No motion, no
 * client JS: the whole section is server-rendered, so the `<h1>` (the LCP
 * element) is never blocked by hydration.
 */
export function Hero() {
  return (
    <section
      id="hero"
      aria-labelledby="hero-heading"
      className={cn(
        fontPoppins.className,
        "relative flex w-full flex-col items-center overflow-hidden bg-black px-6 py-20 md:py-28",
      )}
    >
      <span className="mb-8 inline-flex max-w-full items-center gap-2 rounded-full border border-gray-700 bg-gray-800/50 px-4 py-2 backdrop-blur-sm">
        <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-gray-400">
          {hero.eyebrow}
        </span>
      </span>

      <h1
        id="hero-heading"
        className={cn(
          "max-w-3xl px-6 text-center text-4xl font-medium leading-tight tracking-tighter md:text-5xl lg:text-6xl",
          "bg-gradient-to-b from-white via-white to-white/60 bg-clip-text text-transparent",
        )}
      >
        {hero.headlineLines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </h1>

      <p className="mt-8 max-w-2xl px-6 text-center text-sm text-gray-400 md:text-base">
        {hero.body}
      </p>

      <div className="relative z-10 mt-10 flex flex-wrap items-center justify-center gap-4">
        <Link
          href={hero.primaryCta.href}
          className={cn(heroCta, "bg-gradient-to-b from-white via-white to-white/60 text-black hover:scale-105 active:scale-95")}
        >
          {hero.primaryCta.label}
        </Link>
        <Link
          href={hero.secondaryCta.href}
          className={cn(heroCta, "text-white hover:bg-gray-800/50")}
        >
          {hero.secondaryCta.label}
        </Link>
      </div>

      <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
        {hero.trustPoints.map((point, index) => (
          <li
            key={point}
            className="font-utility text-[length:var(--text-utility-xs)] text-gray-400"
          >
            {index > 0 && <span aria-hidden="true" className="mr-3">·</span>}
            {point}
          </li>
        ))}
      </ul>

      <div className="relative w-full max-w-5xl pb-20 pt-16">
        <div
          className="pointer-events-none absolute left-1/2 top-[-23%] z-0 w-[90%] -translate-x-1/2"
          aria-hidden="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://i.postimg.cc/Ss6yShGy/glows.png"
            alt=""
            className="h-auto w-full"
            loading="eager"
          />
        </div>

        <div className="relative z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://i.postimg.cc/SKcdVTr1/Dashboard2.png"
            alt="Preview of the Virally interface"
            className="h-auto w-full rounded-lg shadow-2xl"
            loading="eager"
          />
        </div>
      </div>
    </section>
  );
}
