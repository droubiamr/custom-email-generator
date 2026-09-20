import { Outlet } from "react-router";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppDataProvider } from "@/components/app-data";

/** The signed-in layout: sidebar on the start side, page content beside it. */
export function AppShell() {
  return (
    <AppDataProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </AppDataProvider>
  );
}
