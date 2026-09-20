/**
 * Translations. i18next keeps one dictionary per language; components call
 * t("key") and get the right text. Switching language also flips the page
 * direction (Arabic is right-to-left).
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ar from "./locales/ar.json";

export type Lang = "en" | "ar";
const STORAGE_KEY = "lang";

function savedLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "ar" || v === "en") return v;
  } catch {
    /* private mode or blocked storage: fall through */
  }
  return navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function dirFor(lang: string): "rtl" | "ltr" {
  return lang.startsWith("ar") ? "rtl" : "ltr";
}

function applyToDocument(lang: string) {
  document.documentElement.lang = lang;
  document.documentElement.dir = dirFor(lang);
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: savedLang(),
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
});

applyToDocument(i18n.language);
i18n.on("languageChanged", (lng) => {
  applyToDocument(lng);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* ignore */
  }
});

export default i18n;
