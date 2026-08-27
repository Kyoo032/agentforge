import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agentforge",
  description: "Local agents workbench for the Toko Token AI gateway",
};

const themeInitScript = `(function(){try{var k="agentforge-theme";var t=localStorage.getItem(k);if(t!=="dark"){document.documentElement.classList.remove("dark");return;}document.documentElement.classList.add("dark");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
