"use client";

import { useState } from "react";
import { Field } from "@/components/primitives/Field";
import { Input } from "@/components/primitives/Input";
import { cn } from "@/lib/cn";
import { assessPassword } from "@/lib/auth/password";
import { authFields } from "@/content/auth";

/**
 * Password input with a visibility toggle and, for new passwords, a live
 * requirements checklist.
 *
 * The toggle is a real `<button>` inside the field, not an icon-only div: it
 * needs a name, a focus ring and a 44px target. Its label states the action it
 * will perform and `aria-pressed` carries the current state, so a screen-reader
 * user is never guessing whether the password is exposed.
 */
export function PasswordField({
  name = "password",
  label = authFields.password.label,
  hint,
  error,
  autoComplete,
  showRequirements = false,
  required = true,
  adornment,
}: {
  name?: string;
  label?: string;
  hint?: string;
  error?: string;
  autoComplete: "new-password" | "current-password";
  showRequirements?: boolean;
  required?: boolean;
  adornment?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");

  const assessment = assessPassword(value);

  return (
    <Field label={label} hint={hint} error={error} adornment={adornment}>
      {({ inputId, describedBy }) => (
        <>
          <div className="relative">
            <Input
              id={inputId}
              name={name}
              type={visible ? "text" : "password"}
              autoComplete={autoComplete}
              required={required}
              invalid={Boolean(error)}
              aria-describedby={describedBy}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              // Room for the toggle so long passwords never run underneath it.
              className="pr-28"
            />
            <button
              type="button"
              onClick={() => setVisible((current) => !current)}
              aria-pressed={visible}
              className={cn(
                "absolute inset-y-0 right-0 inline-flex min-h-11 items-center px-4",
                "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
                "text-[color:var(--color-text-secondary)]",
                "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
                "hover:text-[color:var(--color-text-primary)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
              )}
            >
              {visible ? authFields.password.hideLabel : authFields.password.showLabel}
            </button>
          </div>

          {showRequirements && (
            <ul className="mt-1 flex flex-col gap-1">
              {assessment.requirements.map((requirement) => (
                <li
                  key={requirement.label}
                  className={cn(
                    "flex items-center gap-2 text-[length:var(--text-body-s)]",
                    requirement.met
                      ? "text-[color:var(--color-success)]"
                      : "text-[color:var(--color-text-muted)]",
                  )}
                >
                  {/* Glyph changes with state, so the checklist is readable
                      without perceiving colour. */}
                  <span aria-hidden="true" className="font-utility">
                    {requirement.met ? "✓" : "·"}
                  </span>
                  <span>{requirement.label}</span>
                  <span className="sr-only">
                    {requirement.met ? " — met" : " — not met"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Field>
  );
}
