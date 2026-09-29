export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-[#121a23]">
      <iframe className="h-full w-full border-0" src="/campaign/index.html" title="3.PF shared campaign" />
    </main>
  );
}
