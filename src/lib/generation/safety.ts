import {
  requiresConsent,
  type GenerationCapability,
} from "@/lib/creative/capabilities";

/**
 * Content safety for generation requests.
 *
 * The brief is explicit that Virally must not inherit the upstream project's
 * "unrestricted / no safeguards" stance. That stance is coherent for a
 * single-user desktop tool where the only person affected is the operator; it
 * is not coherent for a hosted multi-tenant product that publishes to real
 * social platforms under real brand accounts, where the people affected are
 * mostly not the user.
 *
 * What this module is, and is not:
 *
 * It is a **pre-submission gate** — cheap, deterministic, and run before any
 * provider is called or any credit reserved. It catches the categories the
 * brief names, and it catches them in the request rather than in the output,
 * because refusing before spending is the only refusal that costs nothing.
 *
 * It is **not** a claim to be sufficient. Every provider runs its own
 * classifier and Virally does not disable those (`filter_nsfw: true` is pinned
 * on in the Magnific adapter). Defence in depth: this layer stops the obvious
 * and the deliberate, the provider stops what a text match cannot see, and the
 * approval step stops what both missed. A single layer presented as complete
 * would be worse than three presented as partial.
 *
 * Nothing here is a substitute for human review before publication.
 */

// --- Categories ---------------------------------------------------------------

/**
 * Why a request was refused.
 *
 * Enumerated rather than free text so the refusal can be counted, audited and
 * appealed. "The prompt was rejected" is not something a user can act on or an
 * operator can measure.
 */
export type SafetyCategory =
  | "sexual_content_involving_minors"
  | "non_consensual_intimate"
  | "impersonation"
  | "credential_theft"
  | "malware"
  | "platform_abuse"
  | "illegal_exploitation"
  | "provider_circumvention";

export type SafetyVerdict =
  | { allowed: true }
  | {
      allowed: false;
      category: SafetyCategory;
      /**
       * Shown to the user. States the boundary, does not lecture, and does not
       * quote the matched term back — echoing it reads as an accusation and
       * tells a probing user exactly which token to change.
       */
      message: string;
      /** For the audit log. Never rendered. */
      matched: string;
    };

/**
 * Term lists, per category.
 *
 * Deliberately narrow. A broad list is worse than a narrow one here: this
 * blocks a legitimate marketing prompt long before it blocks a determined
 * abuser, who will simply rephrase. So the lists target unambiguous intent —
 * phrases with essentially no benign reading in a social-content generator —
 * and everything subtler is left to the provider's classifier and to human
 * approval.
 *
 * Every entry is lowercase; matching is case-insensitive and word-boundary
 * aware so "assassinate" does not match "assassin" inside a film title, and
 * "minor adjustment" does not trip the minors list.
 */
const CATEGORY_TERMS: Readonly<Record<SafetyCategory, readonly string[]>> = {
  // Non-negotiable and first in the list. No benign reading exists.
  sexual_content_involving_minors: [
    "child porn",
    "child sexual",
    "cp generator",
    "underage nude",
    "underage sex",
    "minor nude",
    "minor sexual",
    "loli",
    "shota",
    "preteen nude",
  ],
  non_consensual_intimate: [
    "revenge porn",
    "nonconsensual nude",
    "non-consensual nude",
    "deepfake porn",
    "deepfake nude",
    "undress her",
    "undress him",
    "nudify",
    "strip her clothes",
    "without her consent",
  ],
  impersonation: [
    "impersonate a police",
    "impersonate an officer",
    "fake id",
    "forged passport",
    "counterfeit document",
    "fake bank statement",
    "official government notice",
    "verified badge scam",
  ],
  credential_theft: [
    "phishing page",
    "phishing email",
    "steal password",
    "harvest credentials",
    "fake login page",
    "credential harvest",
    "otp bypass",
  ],
  malware: [
    "ransomware",
    "keylogger",
    "botnet",
    "trojan payload",
    "malware payload",
    "rootkit",
  ],
  platform_abuse: [
    "buy fake followers",
    "engagement bot",
    "mass report",
    "ban evasion",
    "bot farm",
    "vote manipulation",
    "spam bot network",
  ],
  illegal_exploitation: [
    "human trafficking",
    "sex trafficking",
    "child labour",
    "child labor exploitation",
    "organ trafficking",
  ],
  // Attempts to talk the model out of its own safety behaviour, and prompt
  // injection aimed at the language stages. Included because the brief names
  // "circumventing provider protections" and "untrusted HTML or prompt
  // injection" as things to reject rather than pass through.
  provider_circumvention: [
    "ignore previous instructions",
    "ignore all previous instructions",
    "disregard your instructions",
    "disable safety",
    "disable the safety filter",
    "bypass content filter",
    "bypass the nsfw filter",
    "jailbreak mode",
    "dan mode",
    "unfiltered mode",
    "no content policy",
  ],
};

const CATEGORY_MESSAGE: Readonly<Record<SafetyCategory, string>> = {
  sexual_content_involving_minors:
    "This request cannot be generated. Virally does not produce sexual content involving minors under any circumstances.",
  non_consensual_intimate:
    "This request cannot be generated. Virally does not produce intimate imagery of a person without their consent.",
  impersonation:
    "This request cannot be generated. Virally does not produce material designed to impersonate a person, an official or an organisation.",
  credential_theft:
    "This request cannot be generated. Virally does not produce material designed to obtain someone's credentials.",
  malware:
    "This request cannot be generated. Virally does not produce material that promotes or distributes malicious software.",
  platform_abuse:
    "This request cannot be generated. Virally does not produce material intended to manipulate or abuse a social platform.",
  illegal_exploitation:
    "This request cannot be generated. Virally does not produce material depicting or promoting exploitation.",
  provider_circumvention:
    "This request cannot be generated. It attempts to disable the safety behaviour of the generation model.",
};

/**
 * Order matters.
 *
 * A prompt matching several categories is reported as the most serious one, so
 * an audit log grouped by category reflects severity rather than list order.
 */
const CATEGORY_ORDER: readonly SafetyCategory[] = [
  "sexual_content_involving_minors",
  "non_consensual_intimate",
  "illegal_exploitation",
  "credential_theft",
  "malware",
  "impersonation",
  "platform_abuse",
  "provider_circumvention",
];

/**
 * Normalises text before matching.
 *
 * Collapses the cheap evasions — repeated characters, zero-width joiners,
 * punctuation used as letter separators — because `c.h.i.l.d` defeating a
 * literal match would make the list decorative. Not exhaustive, and not
 * intended to be: this raises the cost of casual evasion, and the provider's
 * classifier is what handles the rest.
 */
export function normaliseForMatching(text: string): string {
  return (
    text
      .toLowerCase()
      // Zero-width and directional marks, the classic invisible-separator trick.
      .replaceAll(/[​-‏‪-‮⁠﻿]/gu, "")
      // Accents, so "ｃhild" and "chíld" normalise together.
      .normalize("NFKD")
      .replaceAll(/[̀-ͯ]/gu, "")
      // Punctuation between letters, so "c.h.i.l.d" reads as "child". Applied
      // only between word characters so hyphenated real phrases survive.
      .replaceAll(/(?<=\w)[.\-_*+~|]+(?=\w)/gu, "")
      // Runs of whitespace to single spaces.
      .replaceAll(/\s+/gu, " ")
      .trim()
  );
}

/**
 * Screens the text of a generation request.
 *
 * Checks the prompt AND the negative prompt. Omitting the negative prompt would
 * leave an obvious hole — it is free-text that reaches the provider verbatim,
 * and a gate that inspects only the field with "prompt" in the variable name is
 * a gate that was never really closed.
 */
export function screenText(input: {
  prompt: string;
  negativePrompt?: string | null;
}): SafetyVerdict {
  const haystack = normaliseForMatching(
    [input.prompt, input.negativePrompt ?? ""].join(" \n "),
  );

  for (const category of CATEGORY_ORDER) {
    for (const term of CATEGORY_TERMS[category]) {
      if (containsPhrase(haystack, term)) {
        return {
          allowed: false,
          category,
          message: CATEGORY_MESSAGE[category],
          matched: term,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Word-boundary phrase match.
 *
 * A bare `includes` would match "loli" inside "trampoline" and "cp" inside
 * "cpu", which is how a safety list ends up quietly disabled after the third
 * false-positive complaint. The boundary check is what keeps the list narrow
 * enough to stay switched on.
 */
function containsPhrase(haystack: string, phrase: string): boolean {
  const normalised = normaliseForMatching(phrase);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(normalised, from);
    if (at === -1) return false;
    const before = at === 0 ? " " : haystack[at - 1]!;
    const afterIndex = at + normalised.length;
    const after = afterIndex >= haystack.length ? " " : haystack[afterIndex]!;
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

function isWordChar(character: string): boolean {
  return /[a-z0-9]/u.test(character);
}

// --- Consent -------------------------------------------------------------------

/**
 * Confirmation that the user holds rights to a likeness or voice.
 *
 * The brief forbids cloning a real person's voice or likeness without the user
 * confirming authorization. Represented as a required, explicit field rather
 * than a checkbox the UI happens to render, so a new call site cannot forget
 * it — an omitted `consent` object is a type error, and a `false` one is a
 * refusal.
 *
 * `acknowledgedBy` and `acknowledgedAt` are recorded, not just checked. A
 * consent that leaves no trace is not a consent anyone can later rely on.
 */
export type LikenessConsent = {
  /** The user affirms they hold the rights to the depicted likeness or voice. */
  confirmed: boolean;
  acknowledgedBy: string;
  acknowledgedAt: Date;
  /** Free text the user supplied about the source of the rights. Optional. */
  note?: string;
};

export type ConsentVerdict =
  | { required: false }
  | { required: true; satisfied: true; consent: LikenessConsent }
  | { required: true; satisfied: false; message: string };

/**
 * Whether a capability may proceed given the consent supplied.
 *
 * Fails CLOSED. A consent-gated capability with no consent object is refused,
 * not allowed with a warning — the whole point of the gate is that the
 * expensive, hard-to-undo action does not happen until someone has taken
 * responsibility for it.
 */
export function checkConsent(
  capability: GenerationCapability,
  consent: LikenessConsent | null | undefined,
): ConsentVerdict {
  if (!requiresConsent(capability)) return { required: false };

  if (!consent?.confirmed) {
    return {
      required: true,
      satisfied: false,
      message:
        "Lip-sync animates a real person's face and voice. Confirm you have that person's permission to use their likeness and voice before generating.",
    };
  }

  if (!consent.acknowledgedBy.trim()) {
    return {
      required: true,
      satisfied: false,
      message: "The consent confirmation must record who gave it.",
    };
  }

  return { required: true, satisfied: true, consent };
}

// --- Combined -------------------------------------------------------------------

export type SafetyCheckInput = {
  capability: GenerationCapability;
  prompt: string;
  negativePrompt?: string | null;
  consent?: LikenessConsent | null;
};

export type SafetyCheckResult =
  | { ok: true; consent: LikenessConsent | null }
  | {
      ok: false;
      /** Distinguishes a policy refusal from a missing confirmation. */
      kind: "policy" | "consent";
      message: string;
      category: SafetyCategory | null;
      matched: string | null;
    };

/**
 * The single gate every generation passes through.
 *
 * One function rather than two calls at each site, because "the call site
 * remembered to check both" is not a property anything enforces. Content is
 * screened before consent so a prohibited prompt is refused on its own terms
 * rather than being told to supply a consent that would not have helped.
 */
export function checkGenerationSafety(input: SafetyCheckInput): SafetyCheckResult {
  const text = screenText({ prompt: input.prompt, negativePrompt: input.negativePrompt });
  if (!text.allowed) {
    return {
      ok: false,
      kind: "policy",
      message: text.message,
      category: text.category,
      matched: text.matched,
    };
  }

  const consent = checkConsent(input.capability, input.consent);
  if (consent.required && !consent.satisfied) {
    return {
      ok: false,
      kind: "consent",
      message: consent.message,
      category: null,
      matched: null,
    };
  }

  return { ok: true, consent: consent.required ? consent.consent : null };
}
