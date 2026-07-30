import type { AuthError } from "./errors";

/**
 * The result shape every auth action returns.
 *
 * Lives outside `actions.ts` because a `"use server"` module may only export
 * async functions — a client component importing the initial state from there
 * would be a build error.
 *
 * Actions return errors rather than throwing so a failed submission re-renders
 * the form with the email still in it. Throwing would replace the page with an
 * error boundary and lose the user's input.
 */
export type AuthActionState =
  | { status: "idle" }
  | { status: "error"; error: AuthError; field?: "email" | "password" }
  | { status: "success"; message: string };

export const INITIAL_AUTH_STATE: AuthActionState = { status: "idle" };
