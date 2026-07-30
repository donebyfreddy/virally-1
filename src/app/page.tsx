import { Navbar } from "@/components/navigation/Navbar";
import { CampaignStatusRail } from "@/components/navigation/CampaignStatusRail";
import { Footer } from "@/components/footer/Footer";
import { SkipLink } from "@/components/primitives/SkipLink";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { Hero } from "@/components/hero/Hero";
import { ProofLedger } from "@/components/proof/ProofLedger";
import { BottleneckSection } from "@/components/problem/BottleneckSection";
import { PipelineSection } from "@/components/pipeline/PipelineSection";
import { Multiplier } from "@/components/multiplier/Multiplier";
import { FormatEngine } from "@/components/formats/FormatEngine";
import { ChannelNetwork } from "@/components/channels/ChannelNetwork";
import dynamic from "next/dynamic";
import { RoleSelector } from "@/components/use-cases/RoleSelector";
import { PricingSection } from "@/components/pricing/PricingSection";
import { FinalCta } from "@/components/conversion/FinalCta";
import { AnalyticsBootstrap } from "@/components/analytics/AnalyticsBootstrap";
import { organizationJsonLd, softwareApplicationJsonLd } from "@/lib/seo";

/**
 * The two heaviest client sections, both well below the fold. Code-splitting
 * them keeps their JavaScript out of the initial bundle so it is not parsed
 * before the hero paints. They still server-render, so their content remains
 * in the HTML for search and for readers without JavaScript.
 */
const Laboratory = dynamic(() =>
  import("@/components/laboratory/Laboratory").then((m) => m.Laboratory),
);
const OutputWall = dynamic(() =>
  import("@/components/output-wall/OutputWall").then((m) => m.OutputWall),
);

/**
 * The narrative, in order:
 *
 *   hook → credibility → tension → mechanism → scale → depth → proof → commit
 *
 * Each section owns one mechanic and none repeats another's.
 */
export default function Home() {
  return (
    <MotionProvider>
      <script
        type="application/ld+json"
        // Structured data is static and author-controlled, never user input.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            softwareApplicationJsonLd(),
            organizationJsonLd(),
          ]),
        }}
      />
      <AnalyticsBootstrap />
      <SkipLink />
      <Navbar />
      <CampaignStatusRail />
      <main id="main" className="pt-[var(--nav-height)]">
        <Hero />
        <ProofLedger />
        <BottleneckSection />
        <PipelineSection />
        <Multiplier />
        <FormatEngine />
        <ChannelNetwork />
        <Laboratory />
        <OutputWall />
        <RoleSelector />
        <PricingSection />
        <FinalCta />
      </main>
      <Footer />
    </MotionProvider>
  );
}
