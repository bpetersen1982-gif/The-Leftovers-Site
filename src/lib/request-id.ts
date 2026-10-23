import { headers } from "next/headers";

export const REQUEST_ID_HEADER = "x-request-id";

/** Request id set by src/proxy.ts; used to correlate logs and audit rows. */
export async function getRequestId(): Promise<string | null> {
  return (await headers()).get(REQUEST_ID_HEADER);
}
