import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Shared frame for the sign-in and sign-up screens. */
export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  return (
    <main className="flex min-h-svh flex-col bg-background px-4 py-8">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <div className="mb-8">
          <div className="text-sm font-semibold tracking-tight text-muted-foreground">{t("app.name")}</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        </div>
        {children}
      </div>
      <div className="mx-auto mt-8">
        <Button variant="ghost" size="sm" onClick={() => i18n.changeLanguage(isAr ? "en" : "ar")}>
          {isAr ? "English" : "العربية"}
        </Button>
      </div>
    </main>
  );
}
