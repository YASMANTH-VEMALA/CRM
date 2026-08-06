"use client";

// Superseded by the Entities screen, which manages the same records with the
// full entity fields (code, registered name, currency, timezone, status).
// Kept as a redirect so any bookmarked /dashboard/branches link still lands
// somewhere useful.
import Link from "next/link";
import { EmptyState, PageHead } from "./shared";

export function BranchesView() {
  return (
    <div className="crm-page">
      <PageHead
        eyebrow="Administration"
        title="Branches"
        description="Branches are now managed as entities."
      >
        <Link className="crm-button crm-button-primary" href="/dashboard/entities">
          Open entities <i>→</i>
        </Link>
      </PageHead>
      <EmptyState
        title="This screen has moved"
        hint="Each branch is now an independent entity with its own products, stock, suppliers, staff and reports."
      />
    </div>
  );
}
