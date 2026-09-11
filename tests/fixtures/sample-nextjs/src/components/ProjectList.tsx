"use client";

import { useProjects } from "@/hooks/useProjects";

interface ProjectListProps {
  projects: Array<{ id: string; name: string }>;
}

export default function ProjectList({ projects }: ProjectListProps) {
  const { selected, select } = useProjects();

  return (
    <ul className="project-list">
      {projects.map((project) => (
        <li
          key={project.id}
          className={selected === project.id ? "is-active" : undefined}
          onClick={() => select(project.id)}
        >
          {project.name}
        </li>
      ))}
    </ul>
  );
}
