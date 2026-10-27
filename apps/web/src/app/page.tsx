import { APP_NAME } from '@mbc/shared';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
      <p className="text-base text-slate-600">
        The platform is set up. Features arrive in the next increments.
      </p>
    </main>
  );
}
