This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Supabase setup

This app uses Supabase for Postgres, Auth and Storage. Before running it:

1. **Run the schema.** Paste `supabase/migrations/0001_init.sql` into the Supabase SQL editor and run it. It creates the `profiles`, `posts`, `comments`, `likes`, `follows`, `saves` and `reposts` tables with row level security, the `handle_new_user` trigger that creates a profile for every new account, and the public `media` storage bucket with its policies.
2. **Upload the default avatar.** In Storage → `media`, upload an image named exactly `placeholder-avatar.png`. New profiles point at it until the user picks their own picture. The name must match `NEXT_PUBLIC_PLACEHOLDER_DEAFULT_IMAGE_ID` in `.env` and the default in `handle_new_user()` — extension included.
3. **Disable email confirmation.** Auth → Providers → Email → turn off "Confirm email", so registering signs the user in straight away. If you leave it on, registration will ask the user to confirm their address first.
4. **Fill in `.env`.** Copy `.env.example` to `.env` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Project settings → API.

## Getting Started

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

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
