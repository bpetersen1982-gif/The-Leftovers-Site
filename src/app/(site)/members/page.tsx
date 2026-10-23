import type { Metadata } from "next";
import Link from "next/link";
import { BlockContent } from "@/components/block-content";
import { PageBody } from "@/components/site-chrome";
import { getCurrentUser } from "@/lib/auth/session";
import { listBandMembers } from "@/lib/content/service";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "Members",
  description: "Meet the members of The Leftovers.",
  alternates: { canonical: "/members" },
};

export default async function MembersPage() {
  const [members, viewer] = await Promise.all([listBandMembers(db(), { includeHidden: false }), getCurrentUser()]);
  const canEdit = viewer !== null && can(viewer.role, "members:edit");

  return (
    <PageBody title="Members">
      {members.length === 0 ? (
        <p>Band lineup coming soon.</p>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2">
          {members.map((member) => (
            <li key={member.id} className="panel-paper px-5 py-5">
              <h2 className="font-heading text-2xl font-bold tracking-wider uppercase">{member.name}</h2>
              {member.instrument && <p className="font-heading tracking-wider uppercase">{member.instrument}</p>}
              <div className="mt-3">
                {member.bio.length > 0 ? (
                  <BlockContent blocks={member.bio} tone="paper" />
                ) : (
                  // CNT-7: deliberate empty state, never placeholder text.
                  <p className="italic">Bio coming soon.</p>
                )}
              </div>
              {canEdit && member.bio.length === 0 && (
                <Link href="/admin/members" className="mt-3 inline-block font-semibold underline">
                  Add bio
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </PageBody>
  );
}
