/** Minimal client for the local Mailpit API (docker compose `mailpit` service). */
const MAILPIT_API = process.env.MAILPIT_API ?? "http://127.0.0.1:8026/api/v1";

interface MessageSummary {
  readonly ID: string;
  readonly Subject: string;
  readonly To: readonly { Address: string }[];
}

export async function clearInbox(): Promise<void> {
  const response = await fetch(`${MAILPIT_API}/messages`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Mailpit clear failed: ${response.status}`);
}

/** Waits for the newest email to `to` and returns the first URL in its text body. */
export async function waitForLink(to: string, subjectIncludes: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${MAILPIT_API}/messages`);
    const { messages } = (await response.json()) as { messages: MessageSummary[] };
    const match = messages.find(
      (message) => message.Subject.includes(subjectIncludes) && message.To.some((recipient) => recipient.Address === to),
    );
    if (match) {
      const detail = (await (await fetch(`${MAILPIT_API}/message/${match.ID}`)).json()) as { Text: string };
      const url = detail.Text.match(/https?:\/\/\S+/)?.[0];
      if (!url) throw new Error("Email had no link");
      return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No "${subjectIncludes}" email to ${to} within ${timeoutMs}ms`);
}

export async function countMessagesTo(to: string): Promise<number> {
  const { messages } = (await (await fetch(`${MAILPIT_API}/messages`)).json()) as { messages: MessageSummary[] };
  return messages.filter((message) => message.To.some((recipient) => recipient.Address === to)).length;
}
