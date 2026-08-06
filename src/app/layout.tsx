import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mars Pharmacy CRM | One System for Your Entire Pharmacy",
  description:
    "Manage pharmacy sales, stock, medicine expiry, suppliers, purchasing, customers, expenses, employees, branches, and reports from one centralized platform.",
  keywords: [
    "pharmacy CRM",
    "pharmacy management software",
    "pharmacy POS",
    "medicine inventory",
    "expiry tracking",
    "multi-branch pharmacy",
  ],
  openGraph: {
    title: "Mars Pharmacy CRM",
    description: "Manage your entire pharmacy from one powerful system.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
