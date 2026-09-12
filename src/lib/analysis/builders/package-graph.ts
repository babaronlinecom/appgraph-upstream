import type { AppGraphNode } from "@/lib/graph/model";
import { detectRepositorySignals, parsePackageJson } from "../frameworks/registry";
import { packageForPath, type WorkspacePackage } from "../monorepo/workspace";
import type { RepositoryContext } from "../types";
import { evidenceMetadata } from "./evidence";
import type { EdgeAccumulator } from "./edge-accumulator";
import { fileNodeId, slug } from "./ids";

/**
 * Monorepo projection (AG-MONO-001/002/003):
 * - one `package` node per workspace package with per-package framework
 *   detection (root package.json + files under the package root);
 * - `depends_on` edges only for dependencies that resolve to workspace
 *   packages, with the declaring line in package.json as evidence;
 * - `contains` edges from a package to the analyzed files inside it.
 */
export function packageNodeId(name: string): string {
  return `package:${slug(name)}`;
}

export interface PackageProjection {
  nodes: AppGraphNode[];
  packages: Array<{ pkg: WorkspacePackage; nodeId: string }>;
  dependencyEdges: Array<{ from: string; to: string; dependency: string; line: number; path: string }>;
  fileContainments: Array<{ packageId: string; filePath: string; root: string }>;
}

function dependencyLine(content: string, dependency: string): number {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(`"${dependency}"`));
  return index >= 0 ? index + 1 : 1;
}

function roleForPackage(
  pkg: WorkspacePackage,
  signals: ReturnType<typeof detectRepositorySignals>,
  fileCount: number,
): string {
  if (signals.hasNextDependency && (signals.hasAppDir || signals.hasPagesDir)) return "app";
  if (/^apps\//.test(pkg.root)) return "app";
  if (/worker|jobs?/i.test(pkg.name) || /(^|\/)(worker|jobs?)\//.test(pkg.root)) return "worker";
  if (signals.hasNextDependency) return "app";
  if (fileCount > 0) return "library";
  return "package";
}

export function projectPackages(context: RepositoryContext): PackageProjection {
  const workspace = context.workspace;
  if (!workspace.isMonorepo) {
    return { nodes: [], packages: [], dependencyEdges: [], fileContainments: [] };
  }

  const nodes: AppGraphNode[] = [];
  const packages: PackageProjection["packages"] = [];
  const dependencyEdges: PackageProjection["dependencyEdges"] = [];
  const fileContainments: PackageProjection["fileContainments"] = [];

  const allPaths = context.tree.entries.map((entry) => entry.path);

  for (const pkg of workspace.packages) {
    const packagePaths = allPaths.filter(
      (path) => path === pkg.root || path.startsWith(`${pkg.root}/`),
    );
    const packageJsonContent = context.files.get(pkg.packageJsonPath) ?? "";
    const packageJson = parsePackageJson(packageJsonContent);
    const signals = detectRepositorySignals({ paths: packagePaths, packageJson });
    const analyzedFiles = packagePaths.filter((path) => context.classified.has(path));
    const frameworks = signals.detectedFrameworks.filter((id) => id !== "node");
    const role = roleForPackage(pkg, signals, analyzedFiles.length);

    const workspaceDependencies = Object.keys(pkg.dependencies).filter((dependency) =>
      workspace.byName.has(dependency),
    );

    const nodeId = packageNodeId(pkg.name);
    nodes.push({
      id: nodeId,
      type: "package",
      label: pkg.name,
      subtitle: `${pkg.root}${pkg.version ? ` · v${pkg.version}` : ""}`,
      path: pkg.packageJsonPath,
      confidence: 1,
      granularity: "architecture",
      metadata: {
        group: "packages",
        role,
        packageName: pkg.name,
        packagePath: pkg.root,
        version: pkg.version,
        private: pkg.private,
        frameworks,
        workspaceDependencies,
        fileCount: analyzedFiles.length,
        description: `Workspace ${role} "${pkg.name}" at ${pkg.root} (${analyzedFiles.length} analyzed file(s)${
          frameworks.length > 0 ? `, frameworks: ${frameworks.join(", ")}` : ""
        }).`,
        imports: [],
        exports: [],
      },
      source: { path: pkg.packageJsonPath, startLine: 1 },
    });
    packages.push({ pkg, nodeId });

    for (const dependency of workspaceDependencies) {
      dependencyEdges.push({
        from: nodeId,
        to: packageNodeId(dependency),
        dependency,
        line: dependencyLine(packageJsonContent, dependency),
        path: pkg.packageJsonPath,
      });
    }

    for (const filePath of analyzedFiles.slice(0, 40)) {
      fileContainments.push({ packageId: nodeId, filePath, root: pkg.root });
    }
  }

  return { nodes, packages, dependencyEdges, fileContainments };
}

export function addPackageEdges(
  accumulator: EdgeAccumulator,
  projection: PackageProjection,
): void {
  const knownPackages = new Set(projection.packages.map((entry) => entry.nodeId));
  for (const edge of projection.dependencyEdges) {
    if (!knownPackages.has(edge.to)) continue;
    accumulator.addEdge(
      edge.from,
      edge.to,
      "depends_on",
      0.95,
      evidenceMetadata(
        { label: "package dependency", dependency: edge.dependency },
        { path: edge.path, startLine: edge.line },
        "workspace-manifest",
        "package.dependency",
        "exact",
        `dependency "${edge.dependency}" declared in ${edge.path}`,
      ),
    );
  }

  for (const containment of projection.fileContainments) {
    accumulator.addEdge(
      containment.packageId,
      fileNodeId(containment.filePath),
      "contains",
      0.95,
      evidenceMetadata(
        undefined,
        { path: containment.filePath, startLine: 1 },
        "workspace-manifest",
        "package.contains-file",
        "resolved",
        `${containment.filePath} is inside package root ${containment.root}`,
      ),
    );
  }
}

/** Convenience for UI/queries: workspace package covering a path, if any. */
export function packageForRepositoryPath(
  context: RepositoryContext,
  path: string,
): WorkspacePackage | undefined {
  return packageForPath(context.workspace, path);
}
