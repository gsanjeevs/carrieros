import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { RTL_LOCALES, type Locale } from "@/i18n/request";

export const metadata: Metadata = {
  title: "CarrierOS",
  description: "Fleet management for micro-carriers",
};

// Punjabi (Gurmukhi) and Urdu (Nastaliq) need their own webfonts — loaded
// conditionally, never both, per decisions.md / tech-spec §14.
const LOCALE_FONT_LINKS: Record<Locale, string | null> = {
  en: null,
  es: null,
  pa: "https://fonts.googleapis.com/css2?family=Noto+Sans+Gurmukhi:wght@400;600;700&display=swap",
  ur: "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = (await getLocale()) as Locale;
  const dir = RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
  const fontLink = LOCALE_FONT_LINKS[locale];

  return (
    <html lang={locale} dir={dir} className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
        {fontLink && <link rel="stylesheet" href={fontLink} />}
      </head>
      <body
        className="min-h-full flex flex-col"
        style={
          locale === "pa"
            ? { fontFamily: "'Noto Sans Gurmukhi', sans-serif" }
            : locale === "ur"
              ? { fontFamily: "'Noto Nastaliq Urdu', serif" }
              : undefined
        }
      >
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
