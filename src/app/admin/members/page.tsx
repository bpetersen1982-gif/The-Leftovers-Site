import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { blocksToSource } from "@/lib/content/blocks";
import { listBandMembers } from "@/lib/content/service";
import { db } from "@/lib/db";
import { AddMemberForm, MemberEditor } from "./member-forms";

export const metadata: Metadata = { title: "Members" };

export default async function AdminMembersPage() {
  await requirePermission("members:edit");
  const members = await listBandMembers(db(), { includeHidden: true });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Band members</h1>
        <Link href="/members" className="underline">
          View public page
        </Link>
      </div>
      <p className="text-cream/90">
        This is the public lineup on the Members page. It&apos;s separate from login accounts: adding someone here doesn&apos;t give
        them access, and fill-ins never need an account.
      </p>

      {members.length === 0 ? (
        <p>No members yet.</p>
      ) : (
        <ol className="space-y-6">
          {members.map((member, index) => (
            <li key={member.id}>
              <MemberEditor
                member={{
                  id: member.id,
                  name: member.name,
                  instrument: member.instrument,
                  bio: blocksToSource(member.bio),
                  isVisible: member.isVisible,
                  version: member.version,
                }}
                isFirst={index === 0}
                isLast={index === members.length - 1}
              />
            </li>
          ))}
        </ol>
      )}

      <section aria-labelledby="add-member" className="panel-paper px-5 py-5">
        <h2 id="add-member" className="font-heading text-xl font-bold uppercase">
          Add a member
        </h2>
        <AddMemberForm />
      </section>
    </div>
  );
}
