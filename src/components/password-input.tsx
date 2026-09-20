import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password box with a button to reveal what was typed. Useful on a phone,
 * where a long password is easy to mistype and impossible to check.
 *
 * The wrapper takes the same text direction as the field itself. Passwords
 * are typed in Latin letters, so the pages set the field to left-to-right
 * even in Arabic; without this the button would sit on one side while the
 * space reserved for it was on the other, and the two would overlap.
 */
export function PasswordInput({ className, dir, ...props }: React.ComponentProps<"input">) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative" dir={dir}>
      <Input {...props} dir={dir} type={visible ? "text" : "password"} className={cn("pe-12", className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
        aria-pressed={visible}
        title={visible ? t("auth.hidePassword") : t("auth.showPassword")}
        className="absolute end-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {visible ? <EyeOffIcon className="size-4.5" /> : <EyeIcon className="size-4.5" />}
      </button>
    </div>
  );
}
