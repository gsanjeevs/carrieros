import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { RTL_LOCALES, type Locale } from "@/i18n/request";
import { isThemePreference, serverResolvedClass, THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

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

  // Light/Dark/System theme preference (decisions.md V3/V6). `theme` is
  // synced onto a cookie by proxy.ts from profiles.theme_preference — same
  // mechanism as the `locale` cookie above, see lib/theme.ts. Defaulting to
  // 'system' here is specifically for a visitor with NO cookie at all
  // (never authenticated — the marketing/login pages) — not a claim about
  // what a real profile row defaults to (that's 'dark' as of migration
  // 0030, per V3's explicit requirement). serverResolvedClass() below still
  // renders 'system' as `dark` server-side (this app's actual look), so
  // nothing changes for an anonymous visitor until THEME_BOOTSTRAP_SCRIPT
  // corrects it client-side against their real OS preference — a minor,
  // pre-auth-only nicety, not the "existing/new user" case V3 is about.
  const cookieStore = await cookies();
  const rawTheme = cookieStore.get("theme")?.value;
  const themePreference = isThemePreference(rawTheme) ? rawTheme : "system";
  const themeClass = serverResolvedClass(themePreference);

  return (
    // Sidebar/chrome is styled with literal Tailwind color classes
    // (bg-navy, text-white, etc.), never the semantic `--color-surface-*`/
    // `--color-text-*` tokens this `dark` class controls — see
    // components/Sidebar.tsx — so it renders identically dark navy
    // regardless of this class. Only `components/ui/*` and pages built on
    // the semantic tokens (currently: the personal settings screen) respond
    // to it, per V3's "only the main content surface area switches".
    <html lang={locale} dir={dir} className={["h-full", "antialiased", themeClass].filter(Boolean).join(" ")} suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
        {fontLink && <link rel="stylesheet" href={fontLink} />}
        {themePreference === "system" && (
          // Runs before first paint to correct the conservative server
          // default above against the visitor's actual OS preference — the
          // one case app/layout.tsx can't resolve server-side. Never
          // touches the class for an explicit 'light'/'dark' choice (that
          // was already rendered correctly server-side, zero FOUC).
          <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        )}
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
