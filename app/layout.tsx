import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3.PF Character Sheet",
  description: "A shared Pathfinder campaign workspace with persistent accounts and character sheets.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
