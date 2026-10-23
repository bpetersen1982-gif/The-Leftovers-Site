"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { closeCapture, openCapture } from "@/lib/auth/magic-link-capture";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getRequestId } from "@/lib/request-id";
import { UserServiceError } from "@/lib/users/errors";
import { acceptInvite } from "@/lib/users/service";

export interface AcceptInviteState {
  readonly error: string | null;
  /** One-time login URL for the browser to open as a full page navigation. */
  readonly loginUrl?: string;
}

/**
 * Accepts an invite (POST only, so link scanners in email clients that "preview"
 * links with GET can't burn the invite), then hands back a one-time login link that the
 * browser opens as a normal top-level navigation, exactly like clicking an emailed link.
 * The link goes only to the person who just proved they hold the invite.
 */
export async function acceptInviteAction(_previous: AcceptInviteState, formData: FormData): Promise<AcceptInviteState> {
  const token = formData.get("token");
  if (typeof token !== "string") return { error: "That invite link isn't valid." };
  const requestId = await getRequestId();

  let accepted;
  try {
    accepted = await acceptInvite(db(), { token, requestId });
  } catch (error) {
    if (error instanceof UserServiceError) return { error: error.message };
    throw error;
  }
  logger.info({ requestId, userId: accepted.userId }, "invite accepted");

  // Mint a one-time login link for the new user and follow it instead of emailing it.
  const captureId = openCapture();
  let loginUrl: string | null = null;
  try {
    await auth().api.signInMagicLink({
      body: {
        email: accepted.email,
        callbackURL: "/admin/account?welcome=1",
        errorCallbackURL: "/login",
        metadata: { captureId },
      },
      headers: await headers(),
    });
  } catch (error) {
    logger.error({ requestId, userId: accepted.userId, err: error }, "minting login link after invite failed");
  } finally {
    loginUrl = closeCapture(captureId);
  }
  if (loginUrl) return { error: null, loginUrl };

  logger.error({ requestId, userId: accepted.userId }, "invite accepted but login link was not captured");
  return { error: "Your account is ready, but we couldn't log you in automatically. Use the login page to get a link." };
}
