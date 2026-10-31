import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | DEV102 Smart Proctoring",
  description: "What the Where U Elevate exam app and browser extension collect during an exam, who sees it and how long it is kept.",
};

const SECTIONS = [
  {
    id: "collected",
    title: "What we collect during an exam",
    items: [
      "Your name, email address and the exam you were invited to, from your organization.",
      "A face photo taken at sign-in, used to confirm your identity and shown to your proctor.",
      "Webcam pictures, analysed for who is present and for phones or notes.",
      "Pictures of your entire screen, including every connected display.",
      "Websites you open, your searches, what you type on AI sites and what those AI tools answer.",
      "When you switch tabs or leave the exam, and text you copy.",
      "Your answers, your exam timing and a device identifier that locks your exam link to one computer.",
    ],
  },
  {
    id: "proctoring-consent",
    title: "Proctoring consent",
    items: [
      "Monitoring starts only after you agree on the consent screen and share your screen.",
      "It runs only during your exam and stops when you submit or the exam ends.",
      "Outside an exam, the browser extension collects nothing, even on AI sites.",
      "If you do not agree, do not start the exam, and contact your exam organization.",
    ],
  },
  {
    id: "use",
    title: "How it is used and who sees it",
    items: [
      "Only to run and supervise your exam: your proctor and your organization see it.",
      "Flags are reviewed by a person, who decides whether any marks are deducted.",
      "Automated tools analyse webcam pictures, and may analyse screen pictures to spot AI tools.",
      "We do not sell this data or use it for advertising.",
    ],
  },
  {
    id: "retention",
    title: "How long it is kept",
    items: [
      "Webcam pictures, screen pictures and face photos are deleted after 30 days by default.",
      "Results and exam records are kept for your organization.",
      "To ask for your data or for it to be deleted, contact your exam organization.",
    ],
  },
] as const;

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-heading text-4xl font-semibold text-slate-900">Privacy policy</h1>
      <p className="mt-4 text-lg text-slate-500">This covers the Where U Elevate exam website, desktop app and browser extension.</p>
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="mt-10 scroll-mt-24">
          <h2 className="font-heading text-2xl font-semibold text-slate-900">{s.title}</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-600">
            {s.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ))}
    </main>
  );
}
