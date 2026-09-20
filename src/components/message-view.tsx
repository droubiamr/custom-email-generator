import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeftIcon, ArrowRightIcon, DownloadIcon, ImageIcon, ImageOffIcon, MailIcon, MoreHorizontalIcon, PaperclipIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmailHtml } from "@/components/email-html";
import { useAppData } from "@/components/app-data";
import { useDirection } from "@/components/ui/direction";
import { api } from "@/lib/api";
import { formatBytes, formatWhen } from "@/lib/format";
import type { MessageDetail } from "../../shared/api";

interface Props {
  messageId: string;
  backTo: string;
  onRead: (id: string) => void;
  onUnread: (id: string) => void;
  onDeleted: (id: string) => void;
}

export function MessageView({ messageId, backTo, onRead, onUnread, onDeleted }: Props) {
  const { t, i18n } = useTranslation();
  const dir = useDirection();
  const { refreshCustomers } = useAppData();
  const [msg, setMsg] = useState<MessageDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<"html" | "text">("html");
  const [showImages, setShowImages] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<MessageDetail>(`/api/messages/${messageId}`)
      .then(async (m) => {
        if (cancelled) return;
        setMsg(m);
        setView(m.htmlBody ? "html" : "text");
        if (!m.readAt) {
          await api(`/api/messages/${messageId}/read`, { method: "POST" }).catch(() => {});
          onRead(messageId);
          refreshCustomers().catch(() => {});
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  async function markUnread() {
    await api(`/api/messages/${messageId}/unread`, { method: "POST" });
    onUnread(messageId);
    refreshCustomers().catch(() => {});
  }

  async function remove() {
    try {
      await api(`/api/messages/${messageId}`, { method: "DELETE" });
      onDeleted(messageId);
      refreshCustomers().catch(() => {});
    } catch {
      toast.error(t("auth.generic"));
    }
  }

  const BackIcon = dir === "rtl" ? ArrowRightIcon : ArrowLeftIcon;

  if (failed) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t("errors.notFound")}</div>;
  }
  if (!msg) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const when = formatWhen(msg.receivedAt, i18n.language, { today: t("inbox.today"), yesterday: t("inbox.yesterday") });

  return (
    <article className="flex min-h-0 flex-1 flex-col">
      <header className="border-b px-4 py-3 md:px-6">
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="icon-lg" className="md:hidden" asChild>
            <Link to={backTo} aria-label={t("inbox.back")}>
              <BackIcon />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-snug md:text-xl">{msg.subject}</h2>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium">{msg.fromName || msg.fromAddress}</span>
              {msg.fromName && (
                <span className="text-muted-foreground" dir="ltr">
                  {msg.fromAddress}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("inbox.to")} <span dir="ltr">{msg.toAddress}</span> · {when}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-lg" aria-label={t("nav.openMenu")}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={markUnread}>
                <MailIcon />
                {t("inbox.markUnread")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/messages/${msg.id}/raw`} download>
                  <DownloadIcon />
                  {t("inbox.downloadOriginal")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2Icon />
                {t("inbox.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {msg.htmlBody && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as "html" | "text")}>
              <TabsList>
                <TabsTrigger value="html">{t("inbox.viewHtml")}</TabsTrigger>
                <TabsTrigger value="text">{t("inbox.viewText")}</TabsTrigger>
              </TabsList>
            </Tabs>
            {view === "html" && (
              <Button variant="ghost" size="sm" onClick={() => setShowImages((v) => !v)}>
                {showImages ? <ImageOffIcon /> : <ImageIcon />}
                {showImages ? t("inbox.hideImages") : t("inbox.showImages")}
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {msg.bodyTruncated && (
          <Alert className="m-4 mb-0 md:mx-6">
            <AlertDescription>{t("inbox.truncated")}</AlertDescription>
          </Alert>
        )}
        {view === "html" && msg.htmlBody ? (
          <EmailHtml html={msg.htmlBody} messageId={msg.id} attachments={msg.attachments} showImages={showImages} />
        ) : (
          <pre className="px-4 py-5 font-sans text-[15px] leading-relaxed whitespace-pre-wrap break-words md:px-6" dir="auto">
            {msg.textBody?.trim() || t("inbox.noBody")}
          </pre>
        )}

        {msg.attachments.length > 0 && (
          <section className="border-t px-4 py-4 md:px-6" aria-label={t("inbox.attachments")}>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <PaperclipIcon className="size-4" />
              {t("inbox.attachments")} ({msg.attachments.length})
            </h3>
            <ul className="flex flex-wrap gap-2">
              {msg.attachments.map((a) => (
                <li key={a.id}>
                  <Button variant="outline" size="lg" asChild>
                    <a href={`/api/messages/${msg.id}/attachments/${a.id}`} download={a.filename}>
                      <DownloadIcon />
                      <span className="max-w-60 truncate" dir="ltr">
                        {a.filename}
                      </span>
                      <span className="text-xs text-muted-foreground" dir="ltr">
                        {formatBytes(a.size)}
                      </span>
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("inbox.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("inbox.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("inbox.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              {t("inbox.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
