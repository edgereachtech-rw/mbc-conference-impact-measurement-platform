import { resolveSignIn, SignInPanel } from '@/components/auth/sign-in-panel';

interface HomePageProps {
  searchParams: Promise<{ next?: string; invite?: string }>;
}

/**
 * The front door is signing in (2026-11-02: the marketing landing page was removed). `/signin`
 * serves the same panel, so the links already in people's inboxes keep working.
 */
export default async function HomePage({ searchParams }: HomePageProps) {
  const { next, invite } = await searchParams;
  const state = await resolveSignIn({ next, invite });
  return (
    <main className="flex flex-1 flex-col">
      <SignInPanel {...state} invite={invite} />
    </main>
  );
}
