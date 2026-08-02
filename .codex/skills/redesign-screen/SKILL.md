---
name: redesign-screen
description: Redesign an existing Virally application screen with premium product UX, consistent design foundations, browser inspection and production-quality implementation.
---

# Redesign Screen

Redesign the requested Virally route or interface.

## Input

The user's request describes the target route, screen or workflow.

## Preparation

Before modifying code:

1. Read `AGENTS.md`.
2. Read:
   - `docs/product.md`
   - `docs/design-system.md`
   - `docs/ui-ux.md`
3. Inspect the target route.
4. Inspect related components and data flows.
5. Inspect shared UI primitives.
6. Run the application.
7. Open and examine the current screen.
8. Identify the real user goal.

## External design resources

When available:

- Use UI/UX Pro Max for design-system and UX pattern guidance.
- Use 21st.dev to discover individual components that solve identified needs.
- Use Impeccable principles for critique, visual quality and anti-pattern detection.

Do not combine random components from different visual systems.

Do not install a 21st.dev component merely because it looks attractive.

A new component must:

- solve a real interaction or information problem
- fit the existing stack
- be adaptable to the Virally design system
- remain maintainable
- preserve accessibility

## Diagnosis

Before implementation, determine:

- main user goal
- primary action
- secondary actions
- information hierarchy
- navigation context
- existing UX friction
- missing product states
- elements to preserve
- elements to remove or replace

## Implementation

The redesign must improve more than colors.

Consider:

- information architecture
- task flow
- visual hierarchy
- density
- typography
- navigation
- responsiveness
- accessibility
- content clarity
- feedback
- perceived quality

Preserve:

- working routes
- permissions
- server actions
- data flow
- validation
- business behavior

## Required states

Where applicable, implement:

- loading
- skeleton
- empty
- error
- success
- disabled
- processing
- partial failure
- retry

For AI generation workflows, distinguish:

- queued
- processing
- completed
- partially completed
- failed
- cancelled

## Visual restrictions

Avoid:

- generic dashboard layouts
- nested cards
- excessive gradients
- unnecessary glass effects
- arbitrary shadows
- fake metrics
- placeholder copy
- low contrast
- unusable tables
- excessive rounded containers
- decorative elements without purpose

## Verification

After implementation:

1. Run the application.
2. Inspect the target route.
3. Check mobile, tablet and desktop sizes.
4. Test important interactions.
5. Check overflow and responsive behavior.
6. Run typecheck.
7. Run lint.
8. Run relevant tests.
9. Review the diff.
10. Fix discovered issues.

## Final response

Summarize:

- original UX problems
- new page structure
- components reused
- components introduced
- responsive behavior
- tests and checks
- remaining limitations