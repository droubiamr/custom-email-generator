import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { BellIcon, BellOffIcon, BellRingIcon, ChevronsUpDownIcon, LogOutIcon, PlusIcon, SearchIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppData } from "@/components/app-data";
import { useDirection } from "@/components/ui/direction";
import { signOut } from "@/lib/auth-client";

export function AppSidebar() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const dir = useDirection();
  const { me, customers, customersLoading, query, setQuery, unreadByCustomer } = useAppData();

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    // In Arabic the sidebar belongs on the right, where reading starts.
    <Sidebar collapsible="offcanvas" side={dir === "rtl" ? "right" : "left"}>
      <SidebarHeader className="gap-3 p-3">
        <Link to="/" onClick={closeOnMobile} className="px-1 text-base font-semibold tracking-tight">
          {t("app.name")}
        </Link>
        <Button size="xl" className="w-full" asChild>
          <Link to="/" onClick={closeOnMobile}>
            <PlusIcon />
            {t("nav.newCustomer")}
          </Link>
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pt-0">
          <SidebarGroupContent className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <SidebarInput
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("nav.searchCustomers")}
              aria-label={t("nav.searchCustomers")}
              className="h-10 ps-8"
            />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="pt-0">
          <SidebarGroupLabel>{t("nav.customers")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {customersLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuSkeleton />
                  </SidebarMenuItem>
                ))}
              {!customersLoading && customers.length === 0 && (
                <li className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {query ? t("nav.noMatches") : t("nav.noCustomers")}
                  {!query && <div className="mt-1 text-xs">{t("nav.noCustomersHint")}</div>}
                </li>
              )}
              {customers.map((c) => {
                const unread = unreadByCustomer[c.id] ?? c.unreadCount;
                return (
                  <SidebarMenuItem key={c.id}>
                    <NavLink to={`/c/${c.id}`} onClick={closeOnMobile} className="block">
                      {({ isActive }) => (
                        <SidebarMenuButton size="lg" isActive={isActive} className="h-auto py-2" asChild>
                          <span>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className={`truncate text-sm ${unread > 0 ? "font-semibold" : "font-medium"}`}>
                                {c.name}
                              </span>
                              <span className="truncate text-xs text-muted-foreground" dir="ltr">
                                {c.address}
                              </span>
                            </span>
                          </span>
                        </SidebarMenuButton>
                      )}
                    </NavLink>
                    {unread > 0 && (
                      <SidebarMenuBadge className="top-1/2 -translate-y-1/2 rounded-full bg-primary px-1.5 text-primary-foreground">
                        {unread}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 p-3">
        <NotificationsButton />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-11 w-full justify-between px-3">
              <span className="min-w-0 truncate text-start">
                <span className="block truncate text-sm font-medium">{me?.user.name ?? "…"}</span>
                <span className="block truncate text-xs text-muted-foreground">{me?.user.email ?? ""}</span>
              </span>
              <ChevronsUpDownIcon className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
            <DropdownMenuLabel>{t("nav.language")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={i18n.language.startsWith("ar") ? "ar" : "en"} onValueChange={(v) => i18n.changeLanguage(v)}>
              <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="ar">العربية</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                await signOut();
                navigate("/login", { replace: true });
              }}
            >
              <LogOutIcon />
              {t("nav.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

/** Asks the browser for permission to show desktop notifications. */
function NotificationsButton() {
  const { t } = useTranslation();
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [perm, setPerm] = useState<NotificationPermission>(supported ? Notification.permission : "denied");
  if (!supported) return null;
  if (perm === "granted") {
    return (
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <BellRingIcon className="size-3.5" /> {t("nav.notificationsOn")}
      </div>
    );
  }
  if (perm === "denied") {
    return (
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <BellOffIcon className="size-3.5" /> {t("nav.notificationsBlocked")}
      </div>
    );
  }
  return (
    <Button
      variant="ghost"
      className="h-10 w-full justify-start"
      onClick={async () => setPerm(await Notification.requestPermission())}
    >
      <BellIcon />
      {t("nav.enableNotifications")}
    </Button>
  );
}
