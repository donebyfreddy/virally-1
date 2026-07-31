---
name: virally-frontend-design
description: Design and frontend rules for Virally — both the dark cinematic marketing site and the light authenticated product. Load before creating or editing any component, style, token or motion. Covers product personality, the justification test, typography, spacing, radius, the measured colour palettes, component state requirements, the motion doctrine, the anti-generic prohibitions, and (section 16) the separate light design system that governs everything under /app.
---

# Virally frontend design

The standing reference for every visual and interaction decision on Virally. Read
this before writing a component. If a decision here conflicts with an ad-hoc
instinct, this file wins.

> **Two systems, one product.** Sections 1–15 govern the **marketing site**, which
> is dark and cinematic. **Section 16 governs the authenticated app**, which is
> light, dense and operational, and which deliberately overrides much of what
> follows. If you are editing anything under `src/app/app/**`,
> `src/components/app-shell/**` or `src/components/app-ui/**`, **read section 16
> first** — several rules below are inverted there, and applying the marketing
> typography or the amber accent inside the product is the specific mistake
> section 16 exists to prevent.

---

## 1. Product personality

Virally **is**: fast, precise, ambitious, operational, creative, intelligent,
controlled.

Virally **is not**: cute, magical, childish, futuristic-for-no-reason, chaotic,
aggressively neon, or filled with AI clichés.

### What the product actually is

Most "AI content" tools sell *generation*. Generation is a commodity — it is an
API call. What is not commoditised is the **operational layer**: deciding what
to make, making the right number of variants, recomposing each correctly per
format, routing each to the right authorised account, and closing the loop from
performance back into the next brief.

> **Virally is a content supply chain. The generator is one station on it.**

Therefore the visual language borrows from **NLE timelines, render queues and
broadcast operations rooms** — not from chat UIs, not from dashboards.

### The honesty constraint

Virally **never** promises guaranteed virality. The product increases the speed,
volume and quality of experimentation. The claim is:

> Produce and test more legitimate creative variations with less manual work.

The name creates a promise the product must visibly decline to make. That
refusal, stated plainly, is a trust asset. Never write "10x reach", "guaranteed
virality", "instant growth", or "#1 AI platform".

---

## 2. The justification test

Every visual decision must survive this sentence:

> Because Virally turns one idea into a functioning content network, the
> interface should make **multiplication, movement and distribution** visible.

If a decision cannot be justified by that sentence, cut it.

---

## 3. Typography

Three roles. Three families. **Four weights across the entire site.**

| Role | Family | Weights | Used for |
|---|---|---|---|
| Display | Bricolage Grotesque | 800 | Hero + six section statements only |
| Body | Geist Sans | 400, 500 | All prose |
| Utility | JetBrains Mono | 500 | Metrics, timecodes, labels, states, eyebrows |

### Rules

- Display: `text-wrap: balance`, `letter-spacing: -0.03em`, `line-height: 0.95`.
- Body: 17px mobile / 18px desktop, `line-height: 1.65`, `max-width: 68ch`,
  `text-wrap: pretty`.
- Utility: uppercase for eyebrows at `0.16em` tracking.
  **Always `font-variant-numeric: tabular-nums`** — without it every animated
  metric jitters.
- Never use a high-contrast luxury serif for headlines.
- Geist Sans is permitted as the *body* role only. Inter-family type must never
  become the whole identity — the display and utility roles carry the character.
- Never load a weight that is not in the table above.

### Scale

```
display-xl   clamp(3.25rem, 8vw, 6.5rem)     hero only
display-l    clamp(2.5rem, 5.5vw, 4.25rem)   section headlines
display-m    clamp(2rem, 3.5vw, 2.75rem)     subsections
title        1.5rem
body-l       1.125rem
body         1.0625rem / 1.125rem
body-s       0.9375rem
utility      0.75rem
utility-xs   0.6875rem
```

---

## 4. Spacing

Four-pixel foundation, eight-pixel primary rhythm. **These values only:**

```
4  8  12  16  24  32  48  64  80  96  128  160
```

No arbitrary spacing. Major sections need enough negative space to feel
intentional. Do not place everything inside containers of identical width — the
grid is deliberately asymmetric (a metadata rail against wide media). Dead-centre
`max-w-7xl` on every section is the single clearest tell of a generic build.

---

## 5. Radius

Exactly two values.

- `--radius-sm` **4px** — buttons, fields, chips, compact controls.
- `--radius-lg` **16px** — media frames, major surfaces.

Rails, rules, dividers and section edges have **zero radius**. Not everything
needs rounded corners. No pills unless the element is genuinely a tag.

---

## 6. Colour

All colour is a token. **Never hardcode a hex value inside a component.**
An ESLint rule enforces this.

### The measured palette

Every ratio below was computed with WCAG 2.1 relative luminance, not estimated.

```
--color-canvas          #07090d
--color-surface-1       #10151c    section bands
--color-surface-2       #1a212b    cards, panels
--color-surface-3       #28313f    raised controls, active nodes

--color-text-primary    #f4f7fb    18.54:1 on canvas
--color-text-secondary  #a8b2c1     9.30:1 on canvas
--color-text-muted      #8d99ab     6.90:1 canvas / 5.99:1 s2 / 4.54:1 s3
--color-text-oncolor    #07090d    13.15:1 on action

--color-border-hairline #1f2733    decorative only — never a UI boundary
--color-border          #79849a     3.48:1 minimum across all four surfaces
--color-border-strong   #98a4b5     5.19:1 minimum
--color-focus           #ffca5c    13.15:1

--color-action          #ffca5c    human commitment
--color-signal          #38dfbd    machine activity

--color-success         #4dcc88     9.78:1
--color-warning         #f2b84b    11.13:1
--color-error           #ff7070     7.40:1
--color-info            #6ba8ff     8.23:1
```

Three values were corrected from the original brief after measurement:
`text-muted` was `#727e90` (failed at 4.20:1 on surface-2), the single `border`
token failed UI contrast at 1.76:1 and was split into hairline + interactive, and
the surface ramp was deepened because adjacent steps separated by only 1.06–1.18
were imperceptible.

### The two-accent taxonomy — the most important colour rule

The accents are a **functional taxonomy**, not decoration. A visitor must be able
to learn them in five seconds.

- **Amber `--color-action`** means exactly one thing: *a human must decide or
  commit.* Primary CTA, active selection, approval, focus ring.
- **Teal `--color-signal`** means exactly one thing: *the machine is working.*
  Generating, rendering, publishing, live processing, active data transfer.

Nothing else on the site is ever coloured. No amber section headers. No teal
icon flourishes. No accent-tinted borders "for interest". The payoff is that a
visitor scanning the page instantly parses **where they are in control versus
where the system is running** — which is the trust question this product must
answer.

### Non-colour redundancy — mandatory

State is never carried by colour alone.

- `GENERATING` = teal dot **+** animated ellipsis **+** the literal word.
- Errors = icon **+** text.
- Selected = border-weight change **+** checkmark, never just a fill.

Success-green and signal-teal are the risky colour-vision pair. Never place them
adjacently; success always carries a checkmark.

### Prohibited treatments

No purple→blue gradients. No glassmorphism as a default surface. No glowing
blobs behind the hero. No gradient text.

---

## 7. Components

### Every component ships complete states

Default · Hover · Focus-visible · Pressed · Disabled · Loading · Error (where
relevant). A component without its focus and disabled states is not done.

Focus rings are intentionally designed: 2px `--color-focus`, 2px offset,
measured at 13.15:1. **`outline: none` never appears without an accessible
replacement.**

Touch targets are **44×44px minimum**, including slider thumbs and format chips.
This is asserted in Playwright, not eyeballed.

### Card discipline — the anti-sameness rule

**There is no generic `<Card>` component, and one must never be created.**

Seven structurally distinct surfaces exist. They share tokens, not layout:

| Component | Structure |
|---|---|
| `OutputCard` | media-dominant, 9:16 bias, provenance tag |
| `PlanCard` | vertical price → dimension → objection stack |
| `AccountCard` | avatar + platform glyph + health row |
| `BranchNode` | compact SVG-anchored chip |
| `ProofMetric` | huge tabular figure + tiny label, borderless |
| `EvidenceBlock` | statistic + mandatory citation |
| `RolePreview` | asymmetric split |

Before shipping any section, check: *does this share a layout skeleton with a
previous section?* If yes, rebuild it.

### Forms

The prompt composer needs a real label, placeholder, character handling,
attach-source control, platform selection, submit, loading, error, a keyboard
shortcut hint, and mobile-keyboard-safe behaviour. **Essential instructions never
live only in placeholder text.**

---

## 8. Motion

**Motion depicts the supply chain.** If an animation does not show *generation,
transformation, multiplication, distribution, learning* or *progress*, it does
not ship. Never animate something merely because it entered the viewport.

### Durations

```
--dur-instant   120ms   press, hover, focus
--dur-base      240ms   component state change
--dur-panel     420ms   panel entry, branch draw, format morph
--dur-orch     1400ms   hero orchestration beats only
```

### Easing — five curves, distinct jobs

```
--ease-cut     cubic-bezier(0.2, 0, 0, 1)      decisive "edit cut"; state commits
--ease-settle  cubic-bezier(0.16, 1, 0.3, 1)   arrival; nodes landing
--ease-enter   cubic-bezier(0, 0, 0.2, 1)      appearing
--ease-exit    cubic-bezier(0.4, 0, 1, 1)      leaving (faster than entering)
--ease-linear  linear                          playheads and progress ONLY
```

Nothing uses `ease-in-out`. Progress bars and playheads are strictly linear — an
eased progress bar lies about the underlying process.

### One mechanic per section — no repetition

| Section | Mechanic | Depicts |
|---|---|---|
| S1 Hero | orchestrated 14s timeline: type → parse → branch → render | generation |
| S2 Proof | one-shot count-up, tabular | volume |
| S3 Bottleneck | scroll-linked mitosis: one tile splits into five | cost of manual adaptation |
| S4 Pipeline | sticky viewport, reversible act progression | sequence |
| S5 Multiplier | input-driven branch draw and collapse | multiplication under control |
| S6 Formats | shared-layout aspect-ratio morph | recomposition |
| S7 Channels | assignment edges campaign → account | distribution |
| S8 Laboratory | bidirectional playhead ↔ chart binding | learning |
| S9 Output wall | differential column drift, ~8% delta | volume and range |
| S10 Roles | shared-layout crossfade | fit |
| S11 Pricing | **static, deliberately** | trust |
| S12 Close | single condensed multiplier line | recall |

S11 is motionless by decision. When you ask for money, movement reads as
manipulation.

### Framer Motion architecture

- `LazyMotion` + `domAnimation`, `m.*` components throughout.
- `MotionConfig reducedMotion="user"` at the root — a global switch, not
  per-component conditionals.
- **One `useScroll` per pinned section**, shared to children by context. No
  component instantiates its own observer.
- **Motion values, never state, during scroll.** `useTransform` feeds `style`
  directly; zero re-renders per frame. Discrete scroll-derived values use
  `useMotionValueEvent` with an equality guard so re-renders happen on threshold
  crossings only.
- Animate **only `transform` and `opacity`** while scrolling. SVG paths animate
  `pathLength` (compositor-safe). Never `width`, `height`, `top`, `left`,
  `filter` or `box-shadow`.
- `useSpring` appears **exactly once** — damping hero pointer parallax. Springy
  physics on a professional tool reads as a toy.
- No smooth-scroll library. Native scrolling only.
- Do not add GSAP, Lenis or any second motion system.

### Hover rules

Hover must expose information or operation: preview an output, highlight a
branch path, reveal a tool operating, show before/after, show account
assignment, reveal an explanation.

Never: random card lift, large zoom, constant glow, cursor-chasing decoration,
tilt on every surface.

### Reduced motion is a second complete design — pass/fail

Under `prefers-reduced-motion: reduce`:

- Hero renders its **final** state: prompt filled, branches drawn, statuses
  resolved. No timeline.
- S4 unpins entirely → the stacked card layout, at all widths.
- S3 renders post-split.
- Count-ups render final values immediately.
- Output wall drift stops; posters only, no autoplay.
- The Multiplier stays **fully interactive** — user-initiated transitions drop to
  0ms rather than being removed. Interaction is not motion.
- Pointer parallax and all marquees off.

**Every word of product explanation is present in both modes. No content lives
inside an animation.**

The reduced-motion state is built and reviewed *in the same phase* as its
animated counterpart. It is never a final-phase retrofit.

---

## 9. Reusable motion primitives

Build against these; do not hand-roll equivalents.

```
MotionSection   RevealGroup     StaggerItem      MagneticPointerSurface
CountUp         ScrollProgress  AspectRatioMorph BranchNode
AnimatedPath    ReducedMotionFallback
usePinnedScroll useOrchestration
```

---

## 10. Content and data honesty

All copy lives in `src/content/*.ts` as typed objects. **No marketing copy in
JSX.** No `any`, anywhere.

Every claim carries provenance, enforced by the type system:

```ts
type Provenance =
  | { status: 'verified'; source: string; sourceUrl: string; asOf: `${number}-${number}-${number}` }
  | { status: 'internal-demo' }
  | { status: 'illustrative' }
  | { status: 'placeholder'; required: string };
```

Consequences that follow automatically:

- `CountUp` animates only when `status === 'verified'`.
- `placeholder` renders in an unmistakable dev treatment (dashed amber border,
  monospace, `[REAL METRIC REQUIRED]`).
- The production build **fails** if any placeholder survives.

Never fabricate: metrics, testimonials, customer logos, creator handles,
avatars, view counts, pricing, trial length, credit quantities, generation speed
or revenue results. Never invent a statistic's source or date.

---

## 11. Platform compliance — hard boundaries

Required language wherever accounts are discussed:

> Connect accounts through official authorisation flows. Virally never asks for
> your social passwords.

Virally **may** generate an account launch kit: usernames, bio, profile-image
concepts, content pillars, a first 30-post plan, visual identity, and a manual
setup checklist.

Virally **must never** be described as, or built to perform: automatic creation
of consumer social accounts, CAPTCHA bypass, phone or email verification bypass,
proxy rotation for evasion, fake followers or engagement, automated spam,
credential scraping, or browser automation imitating humans where official APIs
exist.

Never imply Virally bypasses platform restrictions, avoids moderation,
manufactures audiences or manipulates views.

---

## 12. Anti-generic prohibitions

Do not use:

- Gradient text on headings
- Floating chatbot bubbles
- Sparkle icons
- Excessive pill badges
- Identical three-card grids
- Generic dashboard mockups or fake screenshots
- Fake terminal text
- Decorative orbital animations
- Huge blurred circles
- Stock 3D robots
- "Unlocking potential" claims
- "Powered by AI" as the value proposition
- The same fade-up on every section
- Purple AI-chatbot aesthetics
- A visible shadcn/21st.dev component collage

**Product surfaces are real, live DOM running the real interaction.** The
Multiplier is not a picture of a graph; it is a graph you drive. Never ship a
mock screenshot of a product surface.

---

## 13. Integrating third-party components

21st.dev and similar sources may be used as references or foundations. Before
integrating: confirm it solves a real need, strip its local colours and spacing,
map it to Virally tokens, replace placeholder content, fix semantics, add focus
behaviour, add reduced-motion behaviour, verify bundle impact, and make it look
native. Record the source in development notes where licensing requires it.

A coherent custom section beats an impressive inconsistent component.

---

## 14. Performance budget

LCP < 2.0s (4G, 4× CPU) · CLS < 0.05 · INP < 200ms · Lighthouse Perf ≥ 90,
A11y ≥ 95, Best Practices 100.

- The LCP element is the hero `<h1>` — server-rendered text, never blocked by JS
  or media.
- Every media slot has a CSS `aspect-ratio` box reserved at SSR. The navbar
  scroll state animates colour only, never height.
- First-load JS target **< 120 KB gzipped**. Icons imported individually, never
  from a barrel. S8 and S9 are dynamically imported.
- Videos: `preload="none"`, `playsInline`, `muted`, poster always, `<source>`
  attached only near the viewport, **one active video globally**, pause on exit
  and on `visibilitychange`, captions where speech exists.
- `content-visibility: auto` with `contain-intrinsic-size` below the fold.

**Never claim a Lighthouse score without running Lighthouse. Never claim
accessibility compliance without testing it.**

---

## 15. Accessibility floor

WCAG 2.1 AA, verified not asserted. Skip link, semantic landmarks, one `<h1>`,
descending heading order, full keyboard operation, designed focus-visible, no
keyboard traps, Escape on overlays, focus restoration, labelled fields, live
status announcements, video captions and pause controls, 44px targets, state
never colour-only, 200% zoom support, no horizontal overflow at 390px, text
equivalents for every graph, DOM alternatives for every canvas.

SVG visualisations are `aria-hidden` and **always paired with a rendered DOM
equivalent** — a structured list or data table. Information never exists only in
a drawing.

---

## 16. The authenticated app — a second, light design system

Everything under `src/app/app/**`, `src/components/app-shell/**` and
`src/components/app-ui/**` runs on a **separate light system**, defined in
`src/styles/app-theme.css` and scoped to the `.theme-app` class that
`AppShell` puts on the shell root.

Read `src/styles/app-theme.css` before writing app code. It is commented as the
primary reference; this section is the summary and the rules that live outside it.

### Why it is a different system, not a variant

A marketing page persuades with negative space and a near-black stage. An
operations surface earns trust by showing a lot of true state at once, and it is
read for hours. Those are opposite briefs. Sharing one palette between them
produced a product that looked like a developer prototype: near-black canvas,
44px uppercase amber buttons, 44px display headlines above empty tables.

> **Marketing sells the idea. The app runs the supply chain. Density, not drama.**

### What is inverted from sections 1–15

| | Marketing | App |
|---|---|---|
| Canvas | `#07090d` near-black | `#f4f7f8` light |
| Accent | Amber `--color-action` | Teal `--brand-primary` |
| Display face | Bricolage Grotesque 800 | **Never used.** Geist 600 |
| Utility face | JetBrains Mono | **Never used.** Geist, tabular figures |
| Page heading | up to 96px | 28–32px (`app-title`) |
| Buttons | 44px, UPPERCASE, 0.08em | 36px, sentence case, 0em |
| Eyebrows | uppercase 0.16em | **Deleted.** No eyebrows in the app |
| Radius | 4px / 16px | 12px card / 8px control / 6px chip |

The button metrics are tokens (`--button-height`, `--button-case`,
`--button-text`, `--button-tracking`, `--button-px`) read by
`buttonStyles.ts`, so **one** button implementation serves both languages.
Never fork the button.

### The token bridge — and the rule about it

`.theme-app` re-points every legacy `--color-*` name at the light system, which is
what let the whole product convert without rewriting 40 files at once.

**New app code must read the canonical names, never the `--color-*` aliases.**
`--surface-primary`, not `--color-surface-1`. `--brand-primary`, not
`--color-action`.

### Colour pairs — the rule most easily broken

Saturated teals, greens, ambers and reds are all intrinsically light. On white,
**one hex cannot both carry text and read as a mark.** So each is a pair:

- `--{name}` — carries TEXT. ≥4.5:1 on all four app surfaces.
- `--{name}-mark` — dots, bars, strokes, icons, chart series. ≥3:1. **Never text.**
- `--{name}-soft` — the chip background.

Putting `--brand-mark` or a `-mark` on a label is the violation to watch for. It
looks fine and measures 3.7:1.

There is a test that will catch you: `src/lib/accessibility/appPalette.test.ts`
asserts every floor, asserts each hex matches `src/styles/app-theme.css`, and
asserts `--brand-mark` **still fails** the text floor — so nobody can "simplify"
the pair back into one token without the suite going red.

The brief that specified this palette asked for `#10b8aa`. It measures 2.48:1 on
white and fails even the graphical floor. **Measure; do not eyeball.** Three
tokens in the first pass were wrong and all three looked fine.

### Component vocabulary

Compose from these. Do not hand-roll another version of one.

| Need | Use |
|---|---|
| Page container / rhythm / 12-col grid | `AppPage`, `PageStack`, `DashGrid` |
| Page or section heading | `PageHeader`, `SectionHeader` |
| Bordered surface with header/body/footer | `Card`, `CardHeader`, `CardBody`, `CardFooter` |
| Boxed KPI tile / KPI strip | `KpiCard`, `KpiGrid` |
| Borderless figure inside a panel | `Metric`, `MetricRow`, `Delta` |
| Unstructured surface | `Panel`, `PanelSection` |
| Tabular data | `DataTable`, `PrimaryCell`, `CellThumb` |
| Search + filters + view switch | `FilterBar` |
| Empty / loading / error | `EmptyState`, `LoadingState`, `ErrorState` |
| Human review state | `StatusChip` |
| Machine progress | `Progress` |

`Panel` is the unstructured surface; `Card` is the structured one. They share a
border and elevation on purpose — a page mixing them must not show two card
treatments.

### Typography classes

`app-title` (page h1), `app-section-title`, `app-card-title`, `app-label`,
`app-figure`.

**Sentence case everywhere.** `app-label` is uppercase and is the *only*
exception — reserved for table column headers and month-grid weekday headers.
Never a heading. Never a form label. Never a KPI caption (they truncate; six
tiles across 1536px gives each about 130px).

`app-figure` — tabular figures — is **mandatory** on every number. Without it a
column of figures misaligns and animated values jitter.

### Density

Controls `h-8` (32px) or `h-9` (36px). Card padding `--app-panel-pad` (20px).
Content column `--app-content-max` (1536px), not the marketing 1248px — an
operational table has real columns to place. `AppPage width="full"` for the
calendar and editor.

**Target size.** A 36px text button clears WCAG 2.2 SC 2.5.8 (AA, 24×24)
comfortably. Icon-only controls under 44px carry a transparent inset instead:

```
relative … after:absolute after:left-1/2 after:top-1/2 after:size-11
after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']
```

Do **not** apply this to text buttons — a pseudo-element overhanging 4px each
side steals clicks from a control stacked above or below.

### Motion

**Framer Motion is not in the app bundle.** The root layout deliberately does not
mount `MotionProvider`; the marketing page opts in alone. Importing it to slide a
drawer puts ~34KB of JS on every product route to animate two transforms.

Use the keyframes in `app-theme.css` via Tailwind's **arbitrary animation value**:

```
motion-safe:animate-[virally-app-drawer-in_var(--dur-panel)_var(--ease-settle)_backwards]
```

Never a hand-written convenience class like `animate-drawer-in`. Tailwind only
generates variants for utilities it knows about, so `motion-safe:` against a
custom class emits nothing, leaves an unmatched literal string in the markup, and
**silently drops the reduced-motion guard too**. This was a real bug here.

### Empty states carry the first run

A new workspace sees an empty state on nearly every page, so the empty state *is*
the first-run experience. It must be **compact** — icon, one sentence, one primary
and one secondary action — and then get out of the way so real onboarding content
sits underneath it on the same screen.

`/app/campaigns` shows worked-example templates below its empty state;
`/app` shows a three-step checklist whose steps tick themselves from real
workspace state. A compact empty state above a screen and a half of blank canvas
has replaced one problem with another.

### The honesty rules still apply, harder

Section 10 governs the app too, and matters more there because the app renders
real numbers:

- Never fabricate a metric, a thumbnail or a chart. A new workspace returns zeros
  and empty arrays; render a stated empty state, not a demo dataset.
- Derive figures from the ledger or from real rows, never a mutable counter, so a
  number can always be traced to what produced it.
- A capped list says it is capped. Silent truncation reads as completeness.
- Every "nothing here yet" string says what will populate the panel — but in one
  line. A four-line paragraph on the epistemics of sample data is longer than the
  card it sits in.
- A delta against a zero baseline is not a measurable change. Render "no prior
  data", not "+100%".
- A regression is stated in muted text, not red. Red is for something that
  *failed*; a dashboard of red deltas trains the user to ignore red.

### Server-first

Pages stay server components; only genuine interaction crosses the boundary
(`FilterBar`, `Switcher`, `TimeSeriesChart`, `MobileNav`, `Sidebar`, `TopBar`).
List filtering happens **in SQL from URL search params** — validated against its
option set before it reaches the query — never by fetching everything and hiding
rows. That also makes a filtered list a shareable link and the back button an
undo. Batch independent aggregates into one `Promise.all`.
