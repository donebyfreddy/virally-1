/**
 * Derives a readable title from a brief.
 *
 * Trimmed to a readable title rather than left as a several-hundred-character
 * prompt, which makes every list unreadable. The full text is preserved
 * wherever the brief itself is stored.
 *
 * Lives in its own directive-free module rather than in `actions.ts`: that
 * file is `"use server"`, and every export of a server-actions file must be
 * an async function — a plain synchronous export breaks the build the moment
 * a second module (`quickContent.ts`) imports it too.
 */
export function deriveName(prompt: string): string {
  const firstSentence = prompt.split(/[.!?\n]/)[0]?.trim() ?? prompt;
  const cleaned = firstSentence.replace(/^(create|make|generate|build|write)\s+/i, "").trim();
  const name = cleaned.length > 0 ? cleaned : prompt;
  return name.length > 90 ? `${name.slice(0, 87)}…` : name;
}
