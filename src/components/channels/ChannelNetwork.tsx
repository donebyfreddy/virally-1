import { Check, Lock } from "lucide-react";
import { MotionSection, SectionContainer } from "@/components/motion/MotionSection";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { Badge } from "@/components/primitives/Badge";
import { channelNetwork, launchKit, platforms } from "@/content/platforms";
import { cn } from "@/lib/cn";

/**
 * S7 — the authorised account network.
 *
 * This section's job is to remove the "will this get my accounts banned?"
 * objection, so the authorisation language is prominent rather than buried in
 * a footnote, and the account-creation boundary is stated as a limit rather
 * than skirted.
 *
 * Zero client JavaScript.
 */
export function ChannelNetwork() {
  return (
    <MotionSection id="channels" surface="raised" aria-labelledby="channels-heading">
      <SectionContainer>
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Eyebrow>{channelNetwork.eyebrow}</Eyebrow>
            <h2
              id="channels-heading"
              className="font-display mt-6 text-[length:var(--text-display-l)]"
            >
              {channelNetwork.headline}
            </h2>
            <p className="prose-measure mt-6 text-[length:var(--text-body-l)] text-[color:var(--color-text-secondary)]">
              {channelNetwork.body}
            </p>

            {/* The trust statement, given its own weight. */}
            <p
              className={cn(
                "mt-8 flex gap-3 rounded-[var(--radius-lg)] border p-4",
                "border-[var(--color-border)] bg-[var(--color-surface-2)]",
                "text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]",
              )}
            >
              <Lock
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-[color:var(--color-text-secondary)]"
              />
              {channelNetwork.authorisation}
            </p>

            <ul className="mt-8 flex flex-col gap-2">
              {channelNetwork.capabilities.map((capability) => (
                <li
                  key={capability}
                  className="flex gap-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]"
                >
                  <Check
                    aria-hidden="true"
                    className="mt-1 size-3.5 shrink-0 text-[color:var(--color-text-muted)]"
                  />
                  {capability}
                </li>
              ))}
            </ul>
          </div>

          {/* Account table — a distinct structure, not a card grid. */}
          <div className="lg:col-span-7">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-left">
                <caption className="sr-only">
                  Supported platforms, the account types Virally connects to, and
                  the formats each accepts
                </caption>
                <thead>
                  <tr className="border-b border-[var(--color-border-hairline)]">
                    {["Platform", "Account type", "Formats", "Status"].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="pb-3 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {platforms.map((platform) => (
                    <tr
                      key={platform.id}
                      className="border-b border-[var(--color-border-hairline)]"
                    >
                      <th
                        scope="row"
                        className="py-4 pr-4 text-left text-[length:var(--text-body-s)] font-medium text-[color:var(--color-text-primary)]"
                      >
                        {platform.name}
                      </th>
                      <td className="py-4 pr-4 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                        {platform.accountType}
                      </td>
                      <td className="py-4 pr-4 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                        {platform.formats}
                      </td>
                      <td className="py-4">
                        {platform.status === "live" ? (
                          <Badge>Live</Badge>
                        ) : (
                          <Badge tone="neutral">Coming later</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Launch kit — capability and boundary in the same block. */}
            <div
              className={cn(
                "mt-12 rounded-[var(--radius-lg)] border p-6",
                "border-[var(--color-border-hairline)] bg-[var(--color-surface-2)]",
              )}
            >
              <h3 className="font-display text-[length:var(--text-title)]">
                {launchKit.heading}
              </h3>
              <p className="mt-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                {launchKit.body}
              </p>

              <ul className="mt-4 flex flex-wrap gap-2">
                {launchKit.items.map((item) => (
                  <li key={item}>
                    <Badge>{item}</Badge>
                  </li>
                ))}
              </ul>

              <p className="mt-6 border-t border-[var(--color-border-hairline)] pt-4 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
                {launchKit.boundary}
              </p>
            </div>
          </div>
        </div>
      </SectionContainer>
    </MotionSection>
  );
}
