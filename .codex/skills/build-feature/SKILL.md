---
name: build-feature
description: Plan, implement, test and verify a complete Virally product feature while preserving architecture, behavior and design consistency.
---

# Build Feature

Build the requested Virally feature.

## Understand

Read the relevant instructions and documentation.

Inspect:

- routes
- components
- data models
- server actions
- services
- validation
- permissions
- tests
- similar existing features

## Plan

Create a concise plan covering:

- user journey
- page states
- data flow
- files affected
- validation
- authorization
- failures
- testing

## Implement

- Follow existing architecture.
- Reuse established components.
- Validate external input.
- Preserve security boundaries.
- Keep business logic out of UI components.
- Handle all meaningful states.
- Avoid unrelated modifications.

## Verify

Run available relevant commands:

- typecheck
- lint
- unit tests
- integration tests
- build
- Playwright

For UI features:

- run the app
- test the complete workflow
- inspect desktop and mobile
- test failure and loading states

## Final review

Review the diff for:

- regressions
- duplicated logic
- security issues
- accessibility problems
- incomplete states
- unnecessary complexity
- debug artifacts

Fix issues before finishing.