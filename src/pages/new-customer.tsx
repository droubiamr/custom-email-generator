import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAppData } from "@/components/app-data";
import { api, ApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { isValidLocalPart, suggestLocalPart } from "../../shared/address";
import type { CustomerDto } from "../../shared/api";

/**
 * The main screen: type a name, get an address, land in its inbox.
 * The part before "@" is suggested from the name and can be edited.
 */
export function NewCustomerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { me, refreshCustomers } = useAppData();
  const domain = me?.domains[0] ?? null;

  const [name, setName] = useState("");
  // null = follow the suggestion built from the name; string = user edited it.
  const [manualLocalPart, setManualLocalPart] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const localPart = manualLocalPart ?? suggestLocalPart(name);

  const localOk = localPart.length === 0 || isValidLocalPart(localPart);
  const canSubmit = !!domain && name.trim().length > 0 && localPart.length > 0 && localOk && !busy;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !domain) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<CustomerDto>("/api/customers", {
        method: "POST",
        json: { name: name.trim(), localPart, domainId: domain.id },
      });
      // Put the new address on the clipboard straight away: it is almost
      // always the next thing you paste into an application form.
      const copied = await copyText(created.address);
      toast.success(copied ? t("newCustomer.createdAndCopied") : t("newCustomer.created"), {
        description: created.address,
      });
      if (created.address !== `${localPart}@${domain.name}`) {
        toast.info(t("newCustomer.taken"), { description: created.address });
      }
      refreshCustomers().catch(() => {});
      navigate(`/c/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : t("errors.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center gap-2 px-4 md:hidden">
        <SidebarTrigger aria-label={t("nav.openMenu")} />
        <span className="text-sm font-semibold">{t("app.name")}</span>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 md:py-20">
        <h1 className="text-3xl font-semibold tracking-tight">{t("newCustomer.title")}</h1>
        <p className="mt-2 text-base text-muted-foreground">{t("newCustomer.subtitle")}</p>

        <form onSubmit={onSubmit} className="mt-10" noValidate>
          <FieldGroup className="gap-8">
            <Field>
              <FieldLabel htmlFor="customer-name" className="text-base">
                {t("newCustomer.nameLabel")}
              </FieldLabel>
              <Input
                id="customer-name"
                autoFocus
                autoComplete="off"
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-14 px-4 text-lg md:text-lg"
              />
            </Field>

            <Field data-invalid={!localOk || undefined}>
              <FieldLabel htmlFor="local-part" className="text-base">
                {t("newCustomer.addressLabel")}
              </FieldLabel>
              <div
                className="flex h-14 items-center rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive"
                dir="ltr"
              >
                <input
                  id="local-part"
                  aria-invalid={!localOk || undefined}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={40}
                  value={localPart}
                  onChange={(e) => setManualLocalPart(e.target.value.toLowerCase().replace(/\s+/g, "."))}
                  placeholder={name ? "" : "ahmad.alsayed"}
                  className="h-full min-w-0 flex-1 bg-transparent px-4 font-mono text-lg outline-none placeholder:text-muted-foreground/60"
                />
                <span className="shrink-0 select-all pe-4 font-mono text-lg text-muted-foreground">
                  @{domain?.name ?? "…"}
                </span>
              </div>
              {!localOk ? (
                <FieldError>{t("newCustomer.invalidLocalPart")}</FieldError>
              ) : name.trim() && !localPart ? (
                <FieldError>{t("newCustomer.cannotBuild")}</FieldError>
              ) : (
                <FieldDescription>{t("newCustomer.addressHint")}</FieldDescription>
              )}
              {me && !domain && <FieldError>{t("newCustomer.noDomain")}</FieldError>}
              {error && <FieldError>{error}</FieldError>}
            </Field>

            <Button type="submit" size="xl" disabled={!canSubmit} className="w-full md:w-auto md:self-start">
              {busy && <Spinner />}
              {busy ? t("newCustomer.creating") : t("newCustomer.create")}
            </Button>
          </FieldGroup>
        </form>
      </main>
    </div>
  );
}
