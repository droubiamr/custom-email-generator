/**
 * Request validation schemas and response shapes shared by the Worker and
 * the React app. Zod checks incoming JSON before it reaches the database.
 */
import { z } from "zod";
import { LOCAL_PART_MAX, LOCAL_PART_RE } from "./address";

// Largest value JavaScript's Date accepts; anything above is not a time.
const MAX_TIMESTAMP = 8.64e15;

export const createCustomerBody = z.object({
  name: z.string().trim().min(1).max(120),
  localPart: z
    .string()
    .trim()
    .toLowerCase()
    .max(LOCAL_PART_MAX)
    .regex(LOCAL_PART_RE, "Only letters, numbers, dots and dashes")
    .optional(),
  domainId: z.string().uuid().optional(),
});
export type CreateCustomerBody = z.infer<typeof createCustomerBody>;

export const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  customerId: z.string().uuid().optional(),
  cursor: z.coerce.number().int().nonnegative().max(MAX_TIMESTAMP).optional(), // receivedAt ms
  cursorId: z.string().uuid().optional(), // tie-breaker for equal timestamps
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sinceQuery = z.object({
  since: z.coerce.number().int().nonnegative().max(MAX_TIMESTAMP).default(0),
});

export interface DomainDto {
  id: string;
  name: string;
}

export interface MeDto {
  user: { id: string; name: string; email: string };
  domains: DomainDto[];
}

export interface CustomerDto {
  id: string;
  name: string;
  address: string;
  createdAt: number;
  unreadCount: number;
  lastMessageAt: number | null;
}

export interface MessageListItem {
  id: string;
  customerId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  snippet: string;
  hasAttachments: boolean;
  receivedAt: number;
  readAt: number | null;
}

export interface AttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
}

export interface MessageDetail extends MessageListItem {
  toAddress: string;
  textBody: string | null;
  htmlBody: string | null;
  bodyTruncated: boolean;
  attachments: AttachmentDto[];
  customer: { id: string; name: string; address: string };
}

export interface MessageListResponse {
  items: MessageListItem[];
  nextCursor: { receivedAt: number; id: string } | null;
}

export interface NewMessagesDto {
  now: number;
  totalUnread: number;
  unreadByCustomer: Record<string, number>;
  recent: MessageListItem[]; // received after `since`
}
