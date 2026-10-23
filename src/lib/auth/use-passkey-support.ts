"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** True in browsers with WebAuthn. False during server render, so markup stays stable. */
export function usePasskeySupport(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => "PublicKeyCredential" in window,
    () => false,
  );
}
