This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Create a `.env` file with the server-side credentials used by Slack and
Firebase Admin:

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Enable Google in Firebase Authentication, then add the Firebase Web SDK config
and the allowed company email domain. The setup wizard preserves the existing
server credentials and writes the browser config to `.env.local`:

```bash
./scripts/setup-firebase-google-auth.sh
```

The dashboard accepts only verified Google identities from the exact configured
domain (`sennalabs.com` by default). The Google hosted-domain parameter only
guides account selection; authorization is enforced again by the server before
it creates an HttpOnly session cookie.

The Firebase private key must remain server-side. Daily and issue submissions
are stored under `slackChannels/{channelId}` in Firestore.

Resource requests (`/request-resource`, `/borrowed`) are stored in the top-level
`resourceRequests` collection and need `RESOURCE_REQUEST_CHANNEL_ID` set to the
channel their cards are posted to (see `.env.example`). The Slack app needs:

- Slash commands `/request-resource` → `/api/slack/request-resource` and
  `/borrowed` → `/api/slack/borrowed`
- A global shortcut with callback ID `resource_request_shortcut` (optional)
- The `chat:write` and `users:read` bot scopes, and the bot invited to that channel

Buttons and modals use the existing Interactivity URL; see
`docs/adr/0004-resource-requests-in-the-shared-slack-app.md`.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
