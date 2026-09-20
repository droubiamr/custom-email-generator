import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, MoreHorizontalIcon, PaperclipIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NEW_MAIL_EVENT, useAppData } from "@/components/app-data";
import { MessageView } from "@/components/message-view";
import { api, ApiError } from "@/lib/api";
import { formatShort } from "@/lib/format";
import type { CustomerDto, MessageListItem, MessageListResponse } from "../../shared/api";

type Cursor = MessageListResponse["nextCursor"];

export function InboxPage() {
  const { customerId = "", messageId } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { customers, refreshCustomers } = useAppData();

  // The sidebar list is the first source; fall back to a direct fetch when
  // the customer is not in it (for example a filtered search).
  const [fetched, setFetched] = useState<CustomerDto | null>(null);
  const customer = customers.find((c) => c.id === customerId) ?? (fetched?.id === customerId ? fetched : null);
  const [missing, setMissing] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MessageListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<Cursor>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (customers.some((c) => c.id === customerId)) return;
    let cancelled = false;
    api<CustomerDto>(`/api/customers/${customerId}`)
      .then((c) => !cancelled && setFetched(c))
      .catch((err) => {
        if (!cancelled && err instanceof ApiError && err.status === 404) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, customers]);

  const load = useCallback(
    async (cursor?: Cursor) => {
      const params = new URLSearchParams({ customerId });
      if (q.trim()) params.set("q", q.trim());
      if (cursor) {
        params.set("cursor", String(cursor.receivedAt));
        params.set("cursorId", cursor.id);
      }
      return api<MessageListResponse>(`/api/messages?${params}`);
    },
    [customerId, q],
  );

  // First page, re-run when the customer or the search text changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const id = setTimeout(() => {
      load()
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setNextCursor(res.nextCursor);
        })
        .catch(() => {})
        .finally(() => !cancelled && setLoading(false));
    }, q ? 200 : 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [load, q]);

  // New mail for this customer arrives while we are looking: refresh list.
  useEffect(() => {
    function onNew(e: Event) {
      const recent = (e as CustomEvent<MessageListItem[]>).detail;
      if (recent.some((m) => m.customerId === customerId)) {
        load()
          .then((res) => {
            setItems(res.items);
            setNextCursor(res.nextCursor);
          })
          .catch(() => {});
      }
    }
    window.addEventListener(NEW_MAIL_EVENT, onNew);
    return () => window.removeEventListener(NEW_MAIL_EVENT, onNew);
  }, [customerId, load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await load(nextCursor);
      setItems((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  async function copyAddress() {
    if (!customer) return;
    try {
      await navigator.clipboard.writeText(customer.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("auth.generic"));
    }
  }

  async function deleteCustomer() {
    try {
      await api(`/api/customers/${customerId}`, { method: "DELETE" });
      await refreshCustomers();
      navigate("/", { replace: true });
    } catch {
      toast.error(t("auth.generic"));
    }
  }

  const markRead = (id: string) => {
    setItems((prev) => prev.map((m) => (m.id === id && !m.readAt ? { ...m, readAt: Date.now() } : m)));
  };
  const markUnread = (id: string) => {
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, readAt: null } : m)));
  };
  const removeMessage = (id: string) => {
    setItems((prev) => prev.filter((m) => m.id !== id));
    navigate(`/c/${customerId}`, { replace: true });
  };

  if (missing) {
    return (
      <Empty className="min-h-svh">
        <EmptyHeader>
          <EmptyTitle>{t("errors.notFound")}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  const showList = !messageId;

  return (
    <div className="flex h-svh flex-col">
      {/* Customer header */}
      <header className={`flex min-h-14 items-center gap-2 border-b px-3 md:px-5 ${messageId ? "hidden md:flex" : "flex"}`}>
        <SidebarTrigger className="md:hidden" aria-label={t("nav.openMenu")} />
        <div className="min-w-0 flex-1 py-2">
          <h1 className="truncate text-base font-semibold leading-tight md:text-lg">{customer?.name ?? "…"}</h1>
          <button
            type="button"
            onClick={copyAddress}
            className="group flex max-w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            title={t("inbox.copyAddress")}
          >
            <span className="truncate font-mono" dir="ltr">
              {customer?.address ?? ""}
            </span>
            {copied ? <CheckIcon className="size-3.5 shrink-0" /> : <CopyIcon className="size-3.5 shrink-0 opacity-60 group-hover:opacity-100" />}
          </button>
        </div>
        <Button variant="outline" size="lg" onClick={copyAddress} className="hidden md:inline-flex">
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? t("newCustomer.copied") : t("inbox.copyAddress")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-lg" aria-label={t("nav.openMenu")}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
              <Trash2Icon />
              {t("inbox.deleteCustomer")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Message list */}
        <section
          className={`w-full shrink-0 flex-col border-e md:flex md:w-90 lg:w-100 ${showList ? "flex" : "hidden"}`}
          aria-label={t("nav.customers")}
        >
          <div className="relative p-3">
            <SearchIcon className="pointer-events-none absolute top-1/2 start-6 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("inbox.searchMessages")}
              aria-label={t("inbox.searchMessages")}
              className="h-10 ps-9"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <Empty className="py-16">
                <EmptyHeader>
                  <EmptyTitle>{q ? t("inbox.noResults") : t("inbox.empty")}</EmptyTitle>
                  {!q && customer && (
                    <EmptyDescription>{t("inbox.emptyHint", { address: customer.address })}</EmptyDescription>
                  )}
                </EmptyHeader>
              </Empty>
            ) : (
              <ul>
                {items.map((m) => {
                  const unread = !m.readAt;
                  const active = m.id === messageId;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/c/${customerId}/m/${m.id}`)}
                        aria-current={active ? "true" : undefined}
                        className={`flex w-full flex-col gap-0.5 border-b px-4 py-3 text-start transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none ${active ? "bg-muted" : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`size-2 shrink-0 rounded-full ${unread ? "bg-primary" : "bg-transparent"}`}
                            aria-label={unread ? t("inbox.unread") : undefined}
                          />
                          <span className={`min-w-0 flex-1 truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>
                            {m.fromName || m.fromAddress}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatShort(m.receivedAt, i18n.language)}</span>
                        </div>
                        <div className="flex items-center gap-2 ps-4">
                          <span className={`min-w-0 flex-1 truncate text-sm ${unread ? "text-foreground" : "text-muted-foreground"}`}>
                            {m.subject}
                          </span>
                          {m.hasAttachments && <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                        </div>
                        <div className="truncate ps-4 text-xs text-muted-foreground">{m.snippet}</div>
                      </button>
                    </li>
                  );
                })}
                {nextCursor && (
                  <li className="p-3">
                    <Button variant="outline" className="w-full" onClick={loadMore} disabled={loadingMore}>
                      {loadingMore && <Spinner />}
                      {t("inbox.loadMore")}
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </section>

        {/* Message detail */}
        <section className={`min-w-0 flex-1 flex-col md:flex ${showList ? "hidden" : "flex"}`}>
          {messageId ? (
            <MessageView
              key={messageId}
              messageId={messageId}
              backTo={`/c/${customerId}`}
              onRead={markRead}
              onUnread={markUnread}
              onDeleted={removeMessage}
            />
          ) : (
            <div className="hidden flex-1 items-center justify-center text-sm text-muted-foreground md:flex">
              {t("inbox.selectMessage")}
            </div>
          )}
        </section>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("inbox.deleteCustomerTitle", { name: customer?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("inbox.deleteCustomerBody", { address: customer?.address ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("inbox.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteCustomer}>
              {t("inbox.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
