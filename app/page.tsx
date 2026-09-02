import GrassScene from "@/components/grass/GrassScene";

export default function Home() {
  return (
    <>
      <GrassScene />
      <section className="flex min-h-screen w-full items-center justify-center bg-[#050208] px-8 text-center text-white">
        <h2 className="text-3xl font-semibold">Next section</h2>
      </section>
    </>
  );
}
