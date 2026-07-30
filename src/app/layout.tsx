import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "SheetSnap — Sheet music from music videos",
  description:
    "Turn piano and music videos into printable sheet music, line by line. Upload a video or paste a YouTube link — everything is processed locally.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-zinc-50 font-sans text-zinc-900 antialiased">
        {children}
      </body>
    </html>
  );
}
