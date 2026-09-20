# Client Mail

A small tool that gives each customer their own email address on your domain
and shows everything that arrives in one inbox. Built for businesses that
apply for visas, jobs or services on a customer's behalf and need to receive
the replies themselves.

## How it works, in one paragraph

You type a customer's name. The app builds an address such as
`ahmad.alsayed@yourdomain.com` and saves it. Cloudflare Email Routing accepts
every email sent to your domain and hands it to this app's Worker. The Worker
saves the original message file, parses it, and stores it in the database. The
web app polls for new mail every 15 seconds and shows a notification.

## The pieces

| Piece | What it is | Where |
|---|---|---|
| React app | The screens you click on | `src/` |
| Worker | The backend: API and email receiver | `worker/` |
| Shared code | Address rules and API types used by both | `shared/` |
| D1 | Cloudflare's hosted SQLite database | `worker/db/schema.ts`, migrations in `drizzle/` |
| R2 | File storage for original emails and attachments | binding `MAIL` |
| Better Auth | Sign up, sign in, sessions | `worker/auth.ts` |
| shadcn/ui | The buttons, inputs, sidebar and dialogs | `src/components/ui/` |

## Running it on your machine

```bash
npm install
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173. Sign up with an email listed in
`ALLOWED_SIGNUP_EMAILS` (see `wrangler.jsonc` and `.dev.vars`).

To fake an incoming email locally, save a message as `test.eml` and run:

```bash
curl -X POST "http://localhost:5173/cdn-cgi/handler/email?from=someone@example.com&to=ahmad.alsayed@example.test" -H "Content-Type: message/rfc822" --data-binary @test.eml
```

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Tests run inside the real Workers runtime with a throwaway database, so the
email handler, the API and the sign-up allowlist are tested for real.

## Settings

Non-secret settings live in `wrangler.jsonc` under `vars`:

- `APP_URL`: the public address of the app. Used for cookies and CSRF checks.
- `MAIL_DOMAIN`: the domain addresses are created on, for example
  `clients.yourdomain.com`.
Secrets live in `.dev.vars` locally (never committed) and in Cloudflare
secrets in production:

- `BETTER_AUTH_SECRET`: a long random string that signs session cookies.
- `ALLOWED_SIGNUP_EMAILS`: comma-separated list of emails allowed to create an
  account. Missing or empty means nobody can sign up. Set it to `*` to open
  sign-up to everyone (for the future SaaS mode).

## Deploying to Cloudflare

You need a Cloudflare account and a domain whose nameservers point at
Cloudflare. If you already use the domain for your own email, put the
addresses on a subdomain (for example `clients.yourdomain.com`) so your normal
inbox is untouched.

1. Log in once from the terminal:

   ```bash
   npx wrangler login
   ```

2. Create the database and the bucket:

   ```bash
   npx wrangler d1 create custom-email-generator
   npx wrangler r2 bucket create custom-email-generator-mail
   ```

   Copy the `database_id` the first command prints into `wrangler.jsonc`.

3. Set the production values in `wrangler.jsonc`: `APP_URL` to
   `https://mail.yourdomain.com` (or wherever the app will live) and
   `MAIL_DOMAIN` to the domain or subdomain that receives mail. Then set the
   secret:

   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put ALLOWED_SIGNUP_EMAILS
   ```

   For the first, paste a long random string (for example the output of
   `openssl rand -base64 48`). For the second, paste the email addresses
   allowed to sign up, separated by commas.

4. Apply the database migrations to production and deploy:

   ```bash
   npm run db:migrate:remote
   npm run deploy
   ```

5. Give the Worker a hostname. In the Cloudflare dashboard, open the Worker,
   go to Settings, Domains and Routes, and add `mail.yourdomain.com`. It must
   match `APP_URL`.

6. Turn on Email Routing for the mail domain. In the dashboard, open the
   domain, choose Email Routing, enable it, and accept the DNS records it
   offers. Then add a catch-all rule whose action is "Send to a Worker" and
   pick this Worker. From that moment every address on the domain reaches the
   app.

7. Sign up in the deployed app with an email from `ALLOWED_SIGNUP_EMAILS`.

## Security notes

- Every API route requires a session, and every database query is limited to
  the signed-in user's rows.
- Requests that change data are refused when they come from another site.
- Email HTML is cleaned with DOMPurify and shown inside a sandboxed frame.
  Remote images stay blocked until you choose to show them.
- Attachments are always served as downloads with types that browsers cannot
  execute in the app's origin.
- The original `.eml` of every message is kept in R2, so a parsing bug can
  never lose mail. Redelivered messages are recognised and stored once.
- Sign-in attempts are rate limited per visitor.

## Growing into a SaaS later

The data model already has users, domains, addresses and messages. To let
other people sign up with their own domains you would add: a domain setup
screen with the DNS records to add, ownership verification through a TXT
record, and an inbound provider such as Resend whose webhook calls the same
storage code the Email Worker uses today.
