import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/permissions";
import { listActiveUsers, listPendingInvites } from "@/lib/users/queries";
import { InviteForm, RevokeInviteButton, UserControls } from "./user-forms";

export const metadata: Metadata = { title: "Users" };

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Chicago",
});

const NOTICES: Record<string, string> = { removed: "User removed and logged out everywhere." };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const noticeText = notice ? NOTICES[notice] : undefined;
  const actor = await requirePermission("users:view");
  const [users, invites] = await Promise.all([listActiveUsers(db()), listPendingInvites(db())]);

  return (
    <div className="space-y-10">
      <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Users</h1>
      {noticeText && (
        <p role="status" className="border-l-4 border-olive bg-olive/15 px-3 py-2 font-semibold">
          {noticeText}
        </p>
      )}

      <section aria-labelledby="invite-heading" className="panel-paper px-5 py-5">
        <h2 id="invite-heading" className="font-heading text-xl font-bold uppercase">
          Invite someone
        </h2>
        <p className="mt-1 text-sm">They get an email with a one-time link. No public sign-up exists.</p>
        <InviteForm />
      </section>

      <section aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
          Pending invites ({invites.length})
        </h2>
        {invites.length === 0 ? (
          <p className="mt-2 text-cream/90">No pending invites.</p>
        ) : (
          <ul className="mt-3 divide-y divide-olive/50 border-y border-olive/50">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
                <div className="min-w-56 flex-1">
                  <p className="font-semibold">
                    {invite.name} &middot; {ROLE_LABELS[invite.role]}
                  </p>
                  <p className="text-sm text-cream/90">
                    {invite.email} &middot; sent by {invite.invitedByName} &middot; expires{" "}
                    {DATE_FORMAT.format(invite.expiresAt)} CT
                  </p>
                </div>
                <RevokeInviteButton inviteId={invite.id} name={invite.name} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="users-heading">
        <h2 id="users-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
          Active users ({users.length})
        </h2>
        <ul className="mt-3 divide-y divide-olive/50 border-y border-olive/50">
          {users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-start gap-x-6 gap-y-3 py-4">
              <div className="min-w-56 flex-1">
                <p className="font-semibold">
                  {user.name}
                  {user.id === actor.id && " (you)"}
                </p>
                <p className="text-sm text-cream/90">{user.email}</p>
                <p className="text-sm text-cream/90">
                  {user.hasPasskey ? "Passkey set up" : "No passkey yet"} &middot; last active{" "}
                  {user.lastSeenAt ? `${DATE_FORMAT.format(user.lastSeenAt)} CT` : "never"}
                </p>
              </div>
              <UserControls userId={user.id} name={user.name} role={user.role} isSelf={user.id === actor.id} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
