"use client";

import { useState } from "react";
import { Button } from "@/components/primitives/Button";
import { launchKitPage } from "@/content/accounts";

/**
 * Copy and download for a launch kit.
 *
 * The plain-text rendering is built on the server and passed in, so the clipboard and
 * the file contain exactly what the page displays. Building it here from props would
 * be a second formatter to keep in sync with the first.
 *
 * Download uses a Blob and an object URL rather than a route handler: the content is
 * already on the client, and a server round-trip to re-render text we are holding
 * would add a request and an auth check for nothing.
 */
export function LaunchKitExport({ text, filename }: { text: string; filename: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused by permissions policy or an insecure
      // context. Silently leaving the button in its default state is correct here:
      // the same content is on screen and selectable, and the download still works.
      setCopied(false);
    }
  }

  function handleDownload() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    // Released on the next tick rather than immediately: revoking synchronously can
    // cancel the download in some browsers before it has read the blob.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" onClick={handleCopy}>
        {copied ? launchKitPage.actions.copied : launchKitPage.actions.copy}
      </Button>
      <Button type="button" variant="secondary" onClick={handleDownload}>
        {launchKitPage.actions.download}
      </Button>
    </div>
  );
}
