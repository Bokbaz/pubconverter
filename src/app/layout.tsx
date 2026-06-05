import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PUB Converter",
  description: "Convert Microsoft Publisher files to archive, Word, and modern editable bundles.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
