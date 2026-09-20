/** Date and size formatting that follows the selected language. */

export function formatWhen(ms: number, lang: string, labels: { today: string; yesterday: string }): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(d);
  if (sameDay) return `${labels.today} ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `${labels.yesterday} ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatShort(ms: number, lang: string): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(d);
  }
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(d);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
