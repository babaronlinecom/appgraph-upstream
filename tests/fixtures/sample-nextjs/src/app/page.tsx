import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Sample App</h1>
      <Link href="/dashboard">Open dashboard</Link>
    </main>
  );
}
