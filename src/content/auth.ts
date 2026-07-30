/**
 * Authentication copy.
 *
 * All product prose lives in `src/content/*` as typed objects — never in JSX.
 * Nothing here may promise reach, growth or virality; the auth screens are the
 * first product surface a user sees and set the honesty baseline for the rest.
 */

export const authCopy = {
  signUp: {
    eyebrow: "CREATE ACCOUNT",
    heading: "Create your content operation.",
    body: "One brief becomes concepts, scripts, cuts and per-platform variants — then routes to the accounts you have authorised. Set up your workspace to begin.",
    submit: "Create account",
    alternatePrompt: "Already have an account?",
    alternateLabel: "Sign in",
    alternateHref: "/auth/sign-in",
  },
  signIn: {
    eyebrow: "SIGN IN",
    heading: "Back to your operation.",
    body: "Your campaigns, render queue, connected accounts and performance history are where you left them.",
    submit: "Sign in",
    alternatePrompt: "No account yet?",
    alternateLabel: "Create one",
    alternateHref: "/auth/sign-up",
  },
  forgotPassword: {
    eyebrow: "RESET PASSWORD",
    heading: "Send a reset link.",
    body: "Enter the email address on the account. If it exists, we send a single-use link that expires in one hour.",
    submit: "Send reset link",
    alternatePrompt: "Remembered it?",
    alternateLabel: "Back to sign in",
    alternateHref: "/auth/sign-in",
  },
  updatePassword: {
    eyebrow: "SET NEW PASSWORD",
    heading: "Choose a new password.",
    body: "This replaces the password on your account. You will stay signed in on this device.",
    submit: "Save password",
    alternatePrompt: "Changed your mind?",
    alternateLabel: "Back to sign in",
    alternateHref: "/auth/sign-in",
  },
} as const;

export const authFields = {
  email: {
    label: "Email",
    placeholder: "you@company.com",
    hint: "Used for sign-in, confirmations and publishing alerts.",
  },
  password: {
    label: "Password",
    hintNew: "At least 8 characters. Longer beats more complicated.",
    hintExisting: "The password you set when you created the account.",
    showLabel: "Show password",
    hideLabel: "Hide password",
  },
  passwordConfirmation: {
    label: "Confirm new password",
    hint: "Type it once more so a typo cannot lock you out.",
  },
} as const;

export const googleButton = {
  label: "Continue with Google",
  /**
   * Stated plainly next to the button. Users are right to be wary of what a
   * publishing tool does with an account connection, and OAuth sign-in is not
   * an account connection.
   */
  scopeNote:
    "Signs you in with your Google identity only. Connecting a YouTube channel for publishing is a separate, explicit step later.",
  divider: "or",
} as const;

export const legalNote = {
  prefix: "By creating an account you agree to the",
  termsLabel: "Terms",
  termsHref: "/terms",
  conjunction: "and",
  privacyLabel: "Privacy Policy",
  privacyHref: "/privacy",
} as const;

export const passwordSecurityNote =
  "Virally never asks for your social media passwords. Accounts are connected later through each platform's official authorisation flow.";

/**
 * The right-hand panel.
 *
 * This is a diagram of the pipeline's structure, not a data visualisation and
 * not a screenshot. It carries no metrics, because there are none to show a
 * visitor who has no account — inventing them here would be the first thing
 * they see and the first thing that was false.
 */
export const pipelinePreview = {
  eyebrow: "WHAT HAPPENS AFTER THE BRIEF",
  caption: "Illustrative structure. Not a screenshot, and not live data.",
  stages: [
    {
      id: "brief",
      index: "01",
      label: "Brief",
      detail: "A prompt, a URL, a document or an existing video.",
      fanOut: 1,
    },
    {
      id: "concepts",
      index: "02",
      label: "Concepts",
      detail: "Distinct angles, each with its own hooks.",
      fanOut: 3,
    },
    {
      id: "variants",
      index: "03",
      label: "Variants",
      detail: "Recomposed per format — 9:16, 4:5, 1:1, 16:9.",
      fanOut: 9,
    },
    {
      id: "channels",
      index: "04",
      label: "Channels",
      detail: "Scheduled to accounts you have authorised.",
      fanOut: 4,
    },
    {
      id: "learning",
      index: "05",
      label: "Learning",
      detail: "Performance feeds the next brief.",
      fanOut: 1,
    },
  ],
} as const;

export const authErrorPage = {
  eyebrow: "SIGN-IN INTERRUPTED",
  heading: "That did not complete.",
  retryLabel: "Back to sign in",
  retryHref: "/auth/sign-in",
} as const;
