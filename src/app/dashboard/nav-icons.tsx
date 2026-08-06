import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" />
      <rect x="13.5" y="3" width="7.5" height="4.5" />
      <rect x="13.5" y="10" width="7.5" height="11" />
      <rect x="3" y="13" width="7.5" height="8" />
    </>
  ),
  sales: (
    <>
      <path d="M3 7h18l-1.6 10.2a2 2 0 0 1-2 1.8H6.6a2 2 0 0 1-2-1.8L3 7Z" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4" />
    </>
  ),
  "sales-history": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  customers: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  products: (
    <>
      <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </>
  ),
  inventory: (
    <>
      <path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z" />
      <path d="M3 12l9 4.5L21 12M3 16.5 12 21l9-4.5" />
    </>
  ),
  categories: (
    <>
      <path d="M4 4h7l2 2.5h7V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
    </>
  ),
  suppliers: (
    <>
      <rect x="2.5" y="7" width="12" height="9" />
      <path d="M14.5 10h4l3 3.2V16h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </>
  ),
  "purchase-orders": (
    <>
      <rect x="5" y="4" width="14" height="17" rx="0.5" />
      <path d="M9 3.2h6v2.3H9zM8.5 10.5h7M8.5 14h7M8.5 17.5h4" />
    </>
  ),
  "received-orders": (
    <>
      <path d="M4 12V5h16v7" />
      <path d="M4 12l2.2 7h11.6l2.2-7H4Z" />
      <path d="M12 3v7m0 0-2.6-2.6M12 10l2.6-2.6" />
    </>
  ),
  returns: (
    <>
      <path d="M8 8 4 12l4 4" />
      <path d="M4 12h10a6 6 0 0 1 0 12h-1" />
    </>
  ),
  expenses: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="0.5" />
      <path d="M3 10h18" />
      <circle cx="17" cy="14.5" r="1.4" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 21V9M11 21V4M18 21v-7" />
      <path d="M2.5 21h19" />
    </>
  ),
  reports: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4M9 12h6M9 15.5h6M9 8.5h3" />
    </>
  ),
  employees: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M15.5 5.5a3.2 3.2 0 0 1 0 6.2M21 20a6 6 0 0 0-5-5.9" />
    </>
  ),
  branches: (
    <>
      <path d="M5 21V6l7-3 7 3v15" />
      <path d="M5 21h14M9 21v-4h6v4M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
    </>
  ),
  "audit-logs": (
    <>
      <path d="M12 3 4.5 5.5v6c0 5 3.2 7.8 7.5 9.5 4.3-1.7 7.5-4.5 7.5-9.5v-6L12 3Z" />
      <path d="m9 12 2 2 4-4.5" />
    </>
  ),
  notifications: (
    <>
      <path d="M6 10a6 6 0 1 1 12 0c0 4.5 1.4 6 1.4 6H4.6S6 14.5 6 10Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.7 6.3l-1.7 1.7M8 16l-1.7 1.7M17.7 17.7 16 16M8 8 6.3 6.3" />
    </>
  ),
  "ai-assistant": (
    <>
      <path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21" />
      <circle cx="12" cy="12" r="5" />
    </>
  ),
};

export function NavIcon({ slug }: { slug: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[slug] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}
