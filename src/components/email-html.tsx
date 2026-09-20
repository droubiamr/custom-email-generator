/**
 * Shows an email's HTML safely.
 *
 * Email HTML is untrusted: it can carry scripts, tracking pixels and fake
 * login forms. Three layers keep it harmless:
 *   1. DOMPurify strips scripts, event handlers, forms and other dangerous
 *      markup before anything is rendered.
 *   2. The result is shown inside an <iframe sandbox> that does NOT allow
 *      scripts. Nothing in the email can ever run, and its styles cannot
 *      leak into the app.
 *   3. A Content-Security-Policy inside the frame blocks remote images and
 *      fonts until the user chooses "Show remote images", so senders cannot
 *      tell when the mail was opened.
 *
 * The frame keeps our origin (allow-same-origin) only so the app can read
 * the content height and size the frame. With scripts disabled that grants
 * the email nothing.
 *
 * Inline images (cid: references) are loaded by the parent page, which is
 * signed in, and passed into the frame as data: URLs.
 */
import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import type { AttachmentDto } from "../../shared/api";

interface Props {
  html: string;
  messageId: string;
  attachments: AttachmentDto[];
  showImages: boolean;
}

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 20000;
const REMOTE_URL = /^\s*(https?:)?\/\//i;

export function EmailHtml({ html, messageId, attachments, showImages }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(200);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cidMap = await loadInlineImages(messageId, attachments);
      if (cancelled) return;
      setDoc(buildDocument(sanitize(html, cidMap, showImages), showImages));
    })();
    return () => {
      cancelled = true;
    };
  }, [html, messageId, attachments, showImages]);

  // Size the frame to its content so the page scrolls, not the frame.
  function fitToContent() {
    const root = iframeRef.current?.contentDocument?.documentElement;
    if (!root) return;
    setHeight(Math.min(Math.max(root.scrollHeight, MIN_HEIGHT), MAX_HEIGHT));
  }

  useEffect(() => {
    const root = iframeRef.current?.contentDocument?.documentElement;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitToContent);
    observer.observe(root);
    return () => observer.disconnect();
  }, [doc]);

  if (doc === null) return <div className="h-40" />;

  return (
    <iframe
      ref={iframeRef}
      title="email"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      onLoad={fitToContent}
      style={{ height }}
      className="block w-full border-0 bg-white"
    />
  );
}

async function loadInlineImages(messageId: string, attachments: AttachmentDto[]) {
  const map: Record<string, string> = {};
  const inline = attachments.filter(
    (a) => a.contentId && a.mimeType.startsWith("image/") && a.size <= MAX_INLINE_IMAGE_BYTES,
  );
  await Promise.all(
    inline.map(async (a) => {
      try {
        const res = await fetch(`/api/messages/${messageId}/attachments/${a.id}?inline=1`, {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const blob = await res.blob();
        map[a.contentId!] = await blobToDataUrl(blob);
      } catch {
        /* image simply will not show */
      }
    }),
  );
  return map;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function sanitize(html: string, cidMap: Record<string, string>, showImages: boolean): string {
  const purify = DOMPurify(window);
  purify.addHook("uponSanitizeAttribute", (_node, data) => {
    const name = data.attrName;
    if (name === "src" || name === "srcset" || name === "background" || name === "poster") {
      const v = data.attrValue;
      if (/^\s*cid:/i.test(v)) {
        const id = v.replace(/^\s*cid:/i, "").trim();
        if (cidMap[id]) data.attrValue = cidMap[id];
        else data.keepAttr = false;
      } else if (!showImages && REMOTE_URL.test(v)) {
        data.keepAttr = false;
      }
    }
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  return purify.sanitize(html, {
    FORBID_TAGS: ["form", "input", "textarea", "select", "button", "iframe", "object", "embed", "meta", "link", "base", "svg", "math"],
    FORBID_ATTR: ["formaction", "form", "ping"],
    ALLOW_DATA_ATTR: false,
  });
}

function buildDocument(body: string, showImages: boolean): string {
  const imgSrc = showImages ? "data: https: http:" : "data:";
  const fontSrc = showImages ? "data: https:" : "'none'";
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src ${fontSrc}; script-src 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
html,body{margin:0;padding:0}
html{overflow:hidden}
body{padding:20px 24px;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111;overflow-wrap:anywhere;word-break:break-word}
img{max-width:100%;height:auto}
table{max-width:100%}
pre{white-space:pre-wrap}
blockquote{margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #ddd;color:#555}
</style></head><body dir="auto">${body}</body></html>`;
}
