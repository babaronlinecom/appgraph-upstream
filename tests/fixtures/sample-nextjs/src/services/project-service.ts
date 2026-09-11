import { prisma } from "@/lib/db";

export async function listProjects() {
  return prisma.project.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createProject(name: string) {
  return prisma.project.create({ data: { name } });
}

export async function deleteProject(id: string) {
  return prisma.project.delete({ where: { id } });
}
