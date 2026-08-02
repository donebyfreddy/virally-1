# Virally — Codex Instructions

## Product

Virally is an AI content operating system for creators, brands and agencies.

Users provide a prompt, URL, document, product or source video. Virally generates campaign strategy, hooks, scripts, storyboards, images, AI video clips, voiceovers, captions, thumbnails and platform-specific versions.

Users can connect social accounts, organize them by workspace, brand and campaign, schedule content, publish in batches and monitor generation and publishing jobs.

## Primary objective

Build a premium creative operating system, not a generic SaaS admin dashboard.

The interface must feel:

- fast
- creative
- professional
- intelligent
- focused
- operational
- premium

## Required reading

Before product or UX changes, read:

- `docs/product.md`
- `docs/design-system.md`
- `docs/ui-ux.md`

Before architecture or backend changes, read:

- `docs/architecture.md`

## Stack

Inspect `package.json` before assuming dependencies.

Expected technologies include:

- Next.js
- React
- TypeScript
- Tailwind CSS
- Drizzle
- Supabase
- Playwright
- Vitest
- Vercel

Follow the actual repository configuration.

## Workflow

Before substantial changes:

1. Inspect the relevant routes and components.
2. Understand current functionality and data flow.
3. Run the application when possible.
4. Inspect the existing rendered interface.
5. Create a concise implementation plan.
6. Reuse existing components before adding new ones.
7. Implement only the approved scope.
8. Run typecheck, lint and relevant tests.
9. Inspect UI changes in the browser.
10. Review the final diff.

## UI and UX direction

Use the following products only as directional references:

- Linear for operational clarity
- Raycast for speed and command-driven interactions
- Frame.io for media review workflows
- Runway for creative AI tooling
- Vercel for visual restraint

Do not clone any product directly.

## Avoid

Never default to:

- generic admin dashboard templates
- purple and blue gradients everywhere
- excessive glassmorphism
- nested cards
- fake analytics
- decorative charts without user value
- excessive pills
- huge empty dashboard cards
- low-contrast gray text
- inconsistent radius
- inconsistent shadows
- meaningless AI sparkle icons
- non-functional visible controls

## Design principles

- One clear primary action per area.
- Use whitespace intentionally.
- Prefer sections over cards inside cards.
- Use semantic design tokens.
- Keep typography hierarchy obvious.
- Use realistic product content.
- Support loading, empty, error, success and disabled states.
- Design mobile intentionally rather than shrinking desktop.
- Maintain accessible contrast and keyboard behavior.
- Use restrained motion that explains state changes.

## Code quality

- Use TypeScript strictly.
- Avoid `any`.
- Preserve existing routes and behavior.
- Do not rewrite unrelated code.
- Do not introduce dependencies without justification.
- Do not expose secrets.
- Do not put business logic in presentational components.
- Remove dead code and unused imports.
- Do not leave debug code.

## UI verification

For meaningful UI changes:

1. Start the app.
2. Open the affected route.
3. Verify at approximately:
   - 375px
   - 768px
   - 1280px
   - 1440px
4. Test relevant interactions.
5. Check loading, empty and error states.
6. Fix overflow, alignment and spacing problems.
7. Run Playwright where suitable.

Do not claim visual completion without rendered inspection when browser tools are available.

## Completion response

Report:

- what changed
- UX problems addressed
- components reused or introduced
- checks executed
- remaining limitations


## 21st.dev usage

Use the 21st.dev MCP only after identifying a concrete component need.

Before installing a component:

1. Inspect existing project components.
2. Search for a suitable component.
3. Review its dependencies and implementation.
4. Adapt it to Virally tokens and conventions.
5. Remove demo code.
6. Verify accessibility and responsiveness.
7. Do not introduce a conflicting visual language.