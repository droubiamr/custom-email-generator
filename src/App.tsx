import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { DirectionProvider } from "@/components/ui/direction";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { dirFor } from "@/i18n";
import { useSession } from "@/lib/auth-client";
import { AppShell } from "@/components/app-shell";
import { LoginPage } from "@/pages/login";
import { SignupPage } from "@/pages/signup";
import { NewCustomerPage } from "@/pages/new-customer";
import { InboxPage } from "@/pages/inbox";

/** Only lets signed-in users through; everyone else goes to /login. */
function Protected() {
  const { data, isPending } = useSession();
  const location = useLocation();
  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export default function App() {
  const { i18n } = useTranslation();
  const dir = dirFor(i18n.language);
  return (
    <DirectionProvider dir={dir}>
      <TooltipProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route element={<Protected />}>
            <Route element={<AppShell />}>
              <Route index element={<NewCustomerPage />} />
              <Route path="c/:customerId" element={<InboxPage />} />
              <Route path="c/:customerId/m/:messageId" element={<InboxPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster position={dir === "rtl" ? "bottom-left" : "bottom-right"} richColors closeButton />
      </TooltipProvider>
    </DirectionProvider>
  );
}
