import type { Metadata } from "next";
import { Workspace } from "@/components/workspace/Workspace";

interface RepositoryPageProps {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ ref?: string }>;
}

export async function generateMetadata({ params }: RepositoryPageProps): Promise<Metadata> {
  const { owner, repo } = await params;
  return {
    title: `${owner}/${repo} — AppGraph`,
    description: `Interactive software architecture graph for the public GitHub repository ${owner}/${repo}.`,
  };
}

export default async function RepositoryPage({ params, searchParams }: RepositoryPageProps) {
  const { owner, repo } = await params;
  const search = await searchParams;
  const ref = typeof search.ref === "string" ? search.ref : undefined;
  const url = `https://github.com/${owner}/${repo.replace(/\.git$/, "")}`;

  return <Workspace key={url} url={url} expectedSha={ref} />;
}
