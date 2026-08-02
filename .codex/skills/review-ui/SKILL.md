---
name: review-ui
description: Inspect, critique and fix an implemented Virally interface across visual quality, UX, responsiveness and accessibility.
---

# Review UI

Review and improve the requested Virally interface.

## Required context

Read:

- `AGENTS.md`
- `docs/design-system.md`
- `docs/ui-ux.md`

Inspect the actual rendered page, not only the source code.

## Review

Evaluate:

### Hierarchy

- page title
- primary action
- secondary actions
- content order
- visual emphasis
- whitespace

### Consistency

- spacing
- typography
- radius
- borders
- shadows
- iconography
- control heights
- colors

### UX

- action clarity
- unnecessary steps
- confusing copy
- feedback
- recoverability
- dangerous actions
- empty states
- loading states
- error states

### Responsive behavior

Check approximately:

- 375px
- 768px
- 1280px
- 1440px

Look for:

- overflow
- clipping
- unreadable text
- cramped controls
- broken grids
- unusable tables
- overlapping elements

### Accessibility

Check:

- semantic HTML
- accessible names
- labels
- keyboard navigation
- focus visibility
- contrast
- reduced motion
- screen-reader clarity

## Execution

1. Run the application.
2. Open the target screen.
3. Inspect relevant states.
4. Identify concrete problems.
5. Fix them rather than only describing them.
6. Reinspect the corrected screen.
7. Run typecheck, lint and relevant tests.

## Completion

Report:

- problems found
- fixes applied
- viewport sizes checked
- interactions tested
- remaining limitations