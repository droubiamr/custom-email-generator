/**
 * Shared app state: who is signed in, the customer list for the sidebar,
 * unread counts, and the background check for new mail.
 *
 * The check is a simple poll: every 15 seconds while the tab is visible the
 * app asks the server "anything new since <time>?". It is the least fragile
 * way to get notifications and needs no extra infrastructure.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { CustomerDto, MeDto, MessageListItem, NewMessagesDto } from "../../shared/api";

const POLL_MS = 15_000;
export const NEW_MAIL_EVENT = "app:new-mail";

interface AppData {
  me: MeDto | null;
  customers: CustomerDto[];
  customersLoading: boolean;
  query: string;
  setQuery: (q: string) => void;
  refreshCustomers: () => Promise<CustomerDto[]>;
  unreadByCustomer: Record<string, number>;
  totalUnread: number;
}

const Ctx = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppData must be used inside AppDataProvider");
  return v;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [me, setMe] = useState<MeDto | null>(null);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [unreadByCustomer, setUnread] = useState<Record<string, number>>({});
  const [totalUnread, setTotalUnread] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const unreadRef = useRef(unreadByCustomer);

  const refreshCustomers = useCallback(async () => {
    const q = queryRef.current.trim();
    const list = await api<CustomerDto[]>(`/api/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    // Ignore a stale answer if the search box changed while we waited.
    if (queryRef.current.trim() === q) {
      setCustomers(list);
      setCustomersLoading(false);
      // The list carries fresh unread counts; fold them into the badge map
      // so reading a message updates the sidebar without waiting for a poll.
      const next: Record<string, number> = q ? { ...unreadRef.current } : {};
      for (const c of list) next[c.id] = c.unreadCount;
      unreadRef.current = next;
      setUnread(next);
      setTotalUnread(Object.values(next).reduce((a, b) => a + b, 0));
    }
    return list;
  }, []);

  useEffect(() => {
    api<MeDto>("/api/me").then(setMe).catch(() => setMe(null));
  }, []);

  // Search box: wait 200ms after typing stops, then ask the server.
  useEffect(() => {
    const id = setTimeout(() => {
      refreshCustomers().catch(() => setCustomersLoading(false));
    }, 200);
    return () => clearTimeout(id);
  }, [query, refreshCustomers]);

  // Background check for new mail.
  const sinceRef = useRef(Date.now());
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await api<NewMessagesDto>(`/api/messages/new?since=${sinceRef.current}`);
          if (stopped) return;
          sinceRef.current = res.now;
          unreadRef.current = res.unreadByCustomer;
          setUnread(res.unreadByCustomer);
          setTotalUnread(res.totalUnread);
          if (res.recent.length > 0) await announce(res.recent);
        } catch {
          /* offline or signed out: try again next tick */
        }
      }
      timer = setTimeout(poll, POLL_MS);
    }

    async function announce(recent: MessageListItem[]) {
      const list = await refreshCustomers().catch(() => customers);
      window.dispatchEvent(new CustomEvent(NEW_MAIL_EVENT, { detail: recent }));
      for (const msg of recent) {
        const name = list.find((c) => c.id === msg.customerId)?.name ?? "";
        const title = t("notify.newMail", { name });
        toast(title, {
          description: msg.subject,
          action: { label: t("notify.open"), onClick: () => navigate(`/c/${msg.customerId}/m/${msg.id}`) },
        });
        if ("Notification" in window && Notification.permission === "granted") {
          const n = new Notification(title, { body: msg.subject, tag: msg.id });
          n.onclick = () => {
            window.focus();
            navigate(`/c/${msg.customerId}/m/${msg.id}`);
          };
        }
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        poll();
      }
    }

    poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshCustomers, navigate, t]);

  // Show the unread count in the browser tab.
  useEffect(() => {
    const base = t("app.name");
    document.title = totalUnread > 0 ? `(${totalUnread}) ${base}` : base;
  }, [totalUnread, t]);

  return (
    <Ctx.Provider
      value={{ me, customers, customersLoading, query, setQuery, refreshCustomers, unreadByCustomer, totalUnread }}
    >
      {children}
    </Ctx.Provider>
  );
}
