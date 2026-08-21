import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "꿀노트",
  description: "시선과 음성으로 사용하는 핸즈프리 필기 앱",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <head>
        <link
          rel="preload"
          href="/fonts/nanum-pen-script/NanumPenScript-Regular.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <div className="min-h-screen w-full">{children}</div>
      </body>
    </html>
  );
}
