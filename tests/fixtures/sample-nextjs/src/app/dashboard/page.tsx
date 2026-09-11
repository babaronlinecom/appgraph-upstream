import ProjectList from "@/components/ProjectList";

export default async function DashboardPage() {
  const response = await fetch("/api/projects");
  const projects = (await response.json()) as Array<{ id: string; name: string }>;

  return (
    <main className="dashboard">
      <h1>Dashboard</h1>
      <ProjectList projects={projects} />
    </main>
  );
}
