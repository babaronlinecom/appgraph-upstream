"use client";

import { useEffect, useState } from "react";
import { useWorkspace, WorkspaceProvider } from "@/features/workspace/store";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { ProgressPanel } from "./ProgressPanel";
import { ErrorPanel } from "./ErrorPanel";
import { Explorer } from "@/components/explorer/Explorer";
import { Inspector } from "@/components/inspector/Inspector";
import { GraphCanvas } from "@/components/canvas/GraphCanvas";
import { CommandPalette } from "@/components/search/CommandPalette";
import { Toast } from "./Toast";

export function Workspace({ url, expectedSha }: { url: string; expectedSha?: string }) {
  return (
    <WorkspaceProvider url={url} expectedSha={expectedSha}>
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
}

function WorkspaceLayout() {
  const { state, dispatch, retryAnalysis } = useWorkspace();
  const [elapsed, setElapsed] = useState(0);
  const analyzing = state.status === "queued" || state.status === "running" || state.status === "idle";

  useEffect(() => {
    if (!analyzing) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const interval = setInterval(() => setElapsed(Date.now() - started), 200);
    return () => clearInterval(interval);
  }, [analyzing]);

  const complete = state.status === "complete" && Boolean(state.graph);
  const backdropOpen = state.explorerOpen || (state.inspectorOpen && Boolean(state.selectedNodeId));

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <TopBar />

      {complete ? (
        <div className="relative flex min-h-0 flex-1 animate-fade-in">
          {backdropOpen ? (
            <button
              type="button"
              aria-label="Close panels"
              className="fixed bottom-7 left-0 right-0 top-12 z-20 bg-overlay lg:hidden"
              onClick={() => {
                dispatch({ type: "ui/explorer", open: false });
                dispatch({ type: "ui/inspector", open: false });
              }}
            />
          ) : null}
          <Explorer />
          <main className="relative min-w-0 flex-1">
            <GraphCanvas />
          </main>
          <Inspector />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          {state.status === "error" && state.error ? (
            <ErrorPanel error={state.error} onRetry={retryAnalysis} />
          ) : (
            <ProgressPanel
              owner={state.metadata?.owner ?? state.owner}
              repo={state.metadata?.name ?? state.repo}
              steps={state.steps}
              metadata={state.metadata}
              elapsedMs={elapsed}
            />
          )}
        </div>
      )}

      {complete ? <StatusBar /> : null}

      <CommandPalette />
      <Toast message={state.toast?.message} toastKey={state.toast?.id} />
    </div>
  );
}
