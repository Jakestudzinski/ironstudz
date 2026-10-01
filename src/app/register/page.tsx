import { RegisterForm } from "./RegisterForm";

export const metadata = { title: "Create account · ironstudz" };

export default function RegisterPage() {
  return (
    <section className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <RegisterForm />
    </section>
  );
}
