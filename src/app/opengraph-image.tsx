import { ImageResponse } from "next/og";
import { palette } from "@/lib/accessibility/palette";

export const alt = "Virally — one idea, every format, every channel.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social preview, generated rather than hand-designed so it can never drift
 * from the palette. Uses system-weight type: `next/og` cannot read the
 * `next/font` variables, and fetching a font file here would add a build-time
 * network dependency for one image.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: palette.canvas,
          padding: 80,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 0,
              height: 0,
              borderTop: "14px solid transparent",
              borderBottom: "14px solid transparent",
              borderLeft: `22px solid ${palette.action}`,
            }}
          />
          <span
            style={{
              fontSize: 30,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: palette["text-primary"],
            }}
          >
            Virally
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 92, lineHeight: 1, color: palette["text-primary"] }}>
            One idea.
          </span>
          <span style={{ fontSize: 92, lineHeight: 1, color: palette["text-primary"] }}>
            Every format.
          </span>
          <span style={{ fontSize: 92, lineHeight: 1, color: palette.action }}>
            Every channel.
          </span>
        </div>

        <span style={{ fontSize: 26, color: palette["text-secondary"] }}>
          Create, adapt, schedule and improve multi-platform campaigns from one brief.
        </span>
      </div>
    ),
    size,
  );
}
