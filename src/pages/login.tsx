import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { AuthFrame } from "@/components/auth-frame";
import { signIn, useSession } from "@/lib/auth-client";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session, isPending } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isPending && session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(error.status === 401 || error.status === 403 ? t("auth.invalid") : t("auth.generic"));
      return;
    }
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from.startsWith("/") ? from : "/", { replace: true });
  }

  return (
    <AuthFrame title={t("auth.signIn")}>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 px-4 text-base"
              dir="ltr"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t("auth.password")}</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 px-4 text-base"
              dir="ltr"
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <Button type="submit" size="xl" disabled={busy || !email || !password}>
            {busy && <Spinner />}
            {busy ? t("auth.signingIn") : t("auth.signIn")}
          </Button>
        </FieldGroup>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("auth.noAccount")}{" "}
        <Link to="/signup" className="font-medium text-foreground underline underline-offset-4">
          {t("auth.signUp")}
        </Link>
      </p>
    </AuthFrame>
  );
}
