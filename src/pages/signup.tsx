import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { AuthFrame } from "@/components/auth-frame";
import { PasswordInput } from "@/components/password-input";
import { signUp, useSession } from "@/lib/auth-client";

const MIN_PASSWORD = 10;

export function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isPending && session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    const { error } = await signUp.email({ name: name.trim(), email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(error.status === 403 ? t("auth.signUpClosed") : (error.message ?? t("auth.generic")));
      return;
    }
    navigate("/", { replace: true });
  }

  // Only complain about a mismatch once the second box has something in it.
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid =
    name.trim().length > 0 && email.includes("@") && password.length >= MIN_PASSWORD && confirm === password;

  return (
    <AuthFrame title={t("auth.signUp")}>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">{t("auth.name")}</FieldLabel>
            <Input
              id="name"
              autoComplete="name"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-12 px-4 text-base"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 px-4 text-base"
              dir="ltr"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t("auth.password")}</FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 px-4 text-base"
              dir="ltr"
            />
            <FieldDescription>{t("auth.passwordHint")}</FieldDescription>
          </Field>
          <Field data-invalid={mismatch || undefined}>
            <FieldLabel htmlFor="confirm">{t("auth.confirmPassword")}</FieldLabel>
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              required
              aria-invalid={mismatch || undefined}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-12 px-4 text-base"
              dir="ltr"
            />
            {mismatch && <FieldError>{t("auth.passwordMismatch")}</FieldError>}
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <Button type="submit" size="xl" disabled={busy || !valid}>
            {busy && <Spinner />}
            {busy ? t("auth.creating") : t("auth.signUp")}
          </Button>
        </FieldGroup>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("auth.haveAccount")}{" "}
        <Link to="/login" className="font-medium text-foreground underline underline-offset-4">
          {t("auth.signIn")}
        </Link>
      </p>
    </AuthFrame>
  );
}
