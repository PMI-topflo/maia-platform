import type { Metadata } from "next";
import "./globals.css";
import FloatingWidget from "@/components/FloatingWidget";

export const metadata: Metadata = {
  title: "PMI Top Florida Properties",
  description: "Professional HOA and condominium management in South Florida.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,600;1,300&family=DM+Sans:wght@400;500&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <FloatingWidget />
      </body>
    </html>
  );
}
