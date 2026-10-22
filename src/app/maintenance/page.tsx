export const metadata = { title: "Down for maintenance · StudzStock" };

export default function MaintenancePage() {
  return (
    <section className="mx-auto flex max-w-xl flex-col gap-3 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        We&apos;ll be right back
      </h1>
      <p className="opacity-70">
        StudzStock is currently down for scheduled maintenance. Please check back
        in a few minutes.
      </p>
    </section>
  );
}
