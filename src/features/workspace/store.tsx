"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { UserFacingError } from "@/lib/github/errors";
import type {
  AppGraphDocument,
  GraphGranularity,
  GraphGroupId,
  GraphEdgeType,
  RepositoryMetadata,
} from "@/lib/graph/model";
import { GRANULARITY_ORDER } from "@/lib/graph/model";
import type { AnalysisStep } from "@/lib/analysis/pipeline";
import { DEFAULT_FILTERS } from "./selectors";
import {
  buildTour,
  findPath,
  flowToTraceSetup,
  pathToTraceSetup,
  requiredGranularity,
  traceDownstream,
  traceImpact,
  type DetectedFlow,
  type TraceSetup,
} from "./trace";

export interface WorkspaceFilters {
  minConfidence: number;
  showExternal: boolean;
  showConfig: boolean;
  hideLowConfidence: boolean;
  edgeTypes: Record<GraphEdgeType, boolean>;
}

export type WorkspaceStatus = "idle" | "queued" | "running" | "complete" | "error";
export type ExplorerTab = "nodes" | "insights" | "analytics";

interface PositionMap {
  [nodeId: string]: { x: number; y: number };
}

export interface TraceTour {
  title: string;
  setups: TraceSetup[];
  index: number;
}

export interface TraceState extends TraceSetup {
  index: number;
  playing: boolean;
  tour?: TraceTour;
}

export interface WorkspaceState {
  status: WorkspaceStatus;
  url: string;
  owner: string;
  repo: string;
  jobId?: string;
  steps: AnalysisStep[];
  metadata?: RepositoryMetadata;
  graph?: AppGraphDocument;
  error?: UserFacingError;
  granularity: GraphGranularity;
  selectedNodeId?: string;
  hoveredNodeId?: string;
  hoveredEdgeId?: string;
  focusNodeId?: string;
  filters: WorkspaceFilters;
  collapsedGroups: GraphGroupId[];
  paletteOpen: boolean;
  explorerOpen: boolean;
  explorerTab: ExplorerTab;
  inspectorOpen: boolean;
  warningsOpen: boolean;
  toast?: { id: number; message: string };
  manualPositions: Partial<Record<GraphGranularity, PositionMap>>;
  trace?: TraceState;
  pendingPathFrom?: string;
}

type Action =
  | { type: "analysis/start"; url: string; owner: string; repo: string }
  | { type: "analysis/queued"; jobId: string }
  | { type: "analysis/progress"; steps: AnalysisStep[]; metadata?: RepositoryMetadata }
  | {
      type: "analysis/complete";
      graph: AppGraphDocument;
      manualPositions: Partial<Record<GraphGranularity, PositionMap>>;
    }
  | { type: "analysis/error"; error: UserFacingError }
  | { type: "analysis/reset" }
  | { type: "ui/granularity"; granularity: GraphGranularity }
  | { type: "ui/select"; nodeId?: string }
  | { type: "ui/hover"; nodeId?: string }
  | { type: "ui/hoverEdge"; edgeId?: string }
  | { type: "ui/focus"; nodeId?: string }
  | { type: "ui/toggleGroup"; groupId: GraphGroupId }
  | { type: "ui/palette"; open: boolean }
  | { type: "ui/explorer"; open: boolean }
  | { type: "ui/explorerTab"; tab: ExplorerTab }
  | { type: "ui/inspector"; open: boolean }
  | { type: "ui/warnings"; open: boolean }
  | { type: "ui/filter"; patch: Partial<WorkspaceFilters> }
  | { type: "ui/toast"; message?: string }
  | { type: "ui/pathPick"; nodeId?: string }
  | { type: "trace/start"; setup: TraceSetup; playing?: boolean; tour?: TraceTour }
  | { type: "trace/advance" }
  | { type: "trace/prev" }
  | { type: "trace/playing"; playing: boolean }
  | { type: "trace/stop" }
  | { type: "positions/set"; nodeId: string; position: { x: number; y: number } }
  | { type: "positions/reset" };

const initialState = (url: string, owner: string, repo: string): WorkspaceState => ({
  status: "idle",
  url,
  owner,
  repo,
  steps: [],
  granularity: "architecture",
  filters: { ...DEFAULT_FILTERS, edgeTypes: { ...DEFAULT_FILTERS.edgeTypes } },
  collapsedGroups: [],
  paletteOpen: false,
  explorerOpen: false,
  explorerTab: "nodes",
  inspectorOpen: false,
  warningsOpen: false,
  manualPositions: {},
});

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case "analysis/start":
      return {
        ...state,
        status: "queued",
        url: action.url,
        owner: action.owner,
        repo: action.repo,
        error: undefined,
        steps: [],
      };
    case "analysis/queued":
      return { ...state, status: "queued", jobId: action.jobId };
    case "analysis/progress":
      return {
        ...state,
        status: "running",
        steps: action.steps,
        metadata: action.metadata ?? state.metadata,
      };
    case "analysis/complete":
      return {
        ...state,
        status: "complete",
        graph: action.graph,
        metadata: action.graph.repository,
        manualPositions: action.manualPositions,
        explorerOpen: false,
        inspectorOpen: false,
        selectedNodeId: undefined,
        focusNodeId: undefined,
        hoveredNodeId: undefined,
        collapsedGroups: [],
        trace: undefined,
        pendingPathFrom: undefined,
      };
    case "analysis/error":
      return { ...state, status: "error", error: action.error };
    case "analysis/reset":
      return { ...initialState(state.url, state.owner, state.repo), granularity: state.granularity };
    case "ui/granularity":
      return { ...state, granularity: action.granularity, focusNodeId: undefined };
    case "ui/select": {
      let granularity = state.granularity;
      if (action.nodeId && state.graph) {
        const node = state.graph.nodes.find((candidate) => candidate.id === action.nodeId);
        if (node && GRANULARITY_ORDER[node.granularity] > GRANULARITY_ORDER[state.granularity]) {
          granularity = node.granularity;
        }
      }
      return {
        ...state,
        granularity,
        selectedNodeId: action.nodeId,
        inspectorOpen: Boolean(action.nodeId),
        focusNodeId: action.nodeId ?? state.focusNodeId,
      };
    }
    case "ui/hover":
      return { ...state, hoveredNodeId: action.nodeId };
    case "ui/hoverEdge":
      return { ...state, hoveredEdgeId: action.edgeId };
    case "ui/focus":
      return { ...state, focusNodeId: action.nodeId };
    case "ui/toggleGroup": {
      const collapsed = state.collapsedGroups.includes(action.groupId)
        ? state.collapsedGroups.filter((group) => group !== action.groupId)
        : [...state.collapsedGroups, action.groupId];
      return { ...state, collapsedGroups: collapsed };
    }
    case "ui/palette":
      return { ...state, paletteOpen: action.open };
    case "ui/explorer":
      return { ...state, explorerOpen: action.open };
    case "ui/explorerTab":
      return { ...state, explorerTab: action.tab };
    case "ui/inspector":
      return { ...state, inspectorOpen: action.open };
    case "ui/warnings":
      return { ...state, warningsOpen: action.open };
    case "ui/filter":
      return { ...state, filters: { ...state.filters, ...action.patch } };
    case "ui/toast":
      return action.message
        ? { ...state, toast: { id: Date.now(), message: action.message } }
        : { ...state, toast: undefined };
    case "ui/pathPick":
      return { ...state, pendingPathFrom: action.nodeId };
    case "trace/start":
      return {
        ...state,
        trace: {
          ...action.setup,
          index: 0,
          playing: action.playing ?? false,
          tour: action.tour,
        },
        pendingPathFrom: undefined,
      };
    case "trace/advance": {
      const trace = state.trace;
      if (!trace) return state;
      if (trace.index < trace.steps.length - 1) {
        return { ...state, trace: { ...trace, index: trace.index + 1 } };
      }
      const tour = trace.tour;
      if (tour && tour.index < tour.setups.length - 1) {
        const next = tour.setups[tour.index + 1];
        return {
          ...state,
          trace: {
            ...next,
            index: 0,
            playing: true,
            tour: { ...tour, index: tour.index + 1 },
          },
        };
      }
      return { ...state, trace: { ...trace, playing: false } };
    }
    case "trace/prev": {
      const trace = state.trace;
      if (!trace) return state;
      return { ...state, trace: { ...trace, index: Math.max(0, trace.index - 1) } };
    }
    case "trace/playing": {
      const trace = state.trace;
      if (!trace) return state;
      return { ...state, trace: { ...trace, playing: action.playing } };
    }
    case "trace/stop":
      return { ...state, trace: undefined };
    case "positions/set": {
      const current = state.manualPositions[state.granularity] ?? {};
      return {
        ...state,
        manualPositions: {
          ...state.manualPositions,
          [state.granularity]: { ...current, [action.nodeId]: action.position },
        },
      };
    }
    case "positions/reset":
      return {
        ...state,
        manualPositions: { ...state.manualPositions, [state.granularity]: {} },
      };
    default:
      return state;
  }
}

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: React.Dispatch<Action>;
  runAnalysis: () => void;
  retryAnalysis: () => void;
  setManualPosition: (nodeId: string, position: { x: number; y: number }) => void;
  resetPositions: () => void;
  copyShareLink: () => void;
  toast: (message: string) => void;
  selectNode: (nodeId?: string) => void;
  startTrace: (setup: TraceSetup, options?: { playing?: boolean; tour?: TraceTour }) => void;
  startDownstream: (nodeId: string) => void;
  startImpact: (nodeId: string) => void;
  startPathPick: (nodeId: string) => void;
  startFlow: (flow: DetectedFlow) => void;
  startTour: () => void;
  stopTrace: () => void;
  setTracePlaying: (playing: boolean) => void;
  advanceTrace: () => void;
  prevTrace: () => void;
  setExplorerTab: (tab: ExplorerTab) => void;
  openPalette: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}

function positionsStorageKey(owner: string, repo: string, sha: string): string {
  return `appgraph:positions:${owner.toLowerCase()}/${repo.toLowerCase()}@${sha}`;
}

function loadPositions(
  owner: string,
  repo: string,
  sha: string,
): Partial<Record<GraphGranularity, PositionMap>> {
  try {
    const raw = window.localStorage.getItem(positionsStorageKey(owner, repo, sha));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<GraphGranularity, PositionMap>>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function WorkspaceProvider({
  url,
  expectedSha,
  children,
}: {
  url: string;
  expectedSha?: string;
  children: ReactNode;
}) {
  const parsed = useMemo(() => {
    const match = url.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
    return { owner: match?.[1] ?? "", repo: (match?.[2] ?? "").replace(/\.git$/, "") };
  }, [url]);

  const [state, dispatch] = useReducer(reducer, undefined, () =>
    initialState(url, parsed.owner, parsed.repo),
  );
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollController = useRef<AbortController | null>(null);

  const loadPositionMap = useCallback(
    (owner: string, repo: string, sha: string) => loadPositions(owner, repo, sha),
    [],
  );

  const runAnalysis = useCallback(() => {
    let cancelled = false;
    let restarts = 0;
    const controller = new AbortController();
    pollController.current?.abort();
    pollController.current = controller;

    const poll = async (jobId: string) => {
      try {
        const response = await fetch(`/api/analysis/${jobId}`, { signal: controller.signal, cache: "no-store" });
        if (cancelled) return;
        if (response.status === 404) {
          // Dev servers can restart and drop in-memory jobs. Restart the analysis
          // automatically instead of surfacing a confusing error.
          if (restarts < 2) {
            restarts += 1;
            await start();
            return;
          }
        }
        const data = (await response.json()) as {
          status: string;
          steps: AnalysisStep[];
          metadata?: RepositoryMetadata;
          graph?: AppGraphDocument;
          error?: UserFacingError;
        };
        if (cancelled) return;
        if (!response.ok) {
          dispatch({
            type: "analysis/error",
            error: data.error ?? { code: "INTERNAL", title: "Analysis failed", message: "Unexpected server response.", retryable: true },
          });
          return;
        }
        dispatch({ type: "analysis/progress", steps: data.steps ?? [], metadata: data.metadata });
        if (data.status === "complete" && data.graph) {
          const positions = loadPositionMap(
            data.graph.repository.owner,
            data.graph.repository.name,
            data.graph.commitSha,
          );
          dispatch({ type: "analysis/complete", graph: data.graph, manualPositions: positions });
          return;
        }
        if (data.status === "error") {
          dispatch({
            type: "analysis/error",
            error: data.error ?? { code: "INTERNAL", title: "Analysis failed", message: "Unknown error.", retryable: true },
          });
          return;
        }
        pollRef.current = setTimeout(() => poll(jobId), 650);
      } catch (error) {
        if (cancelled || (error as { name?: string }).name === "AbortError") return;
        dispatch({
          type: "analysis/error",
          error: {
            code: "GITHUB_UNAVAILABLE",
            title: "Connection lost",
            message: "Could not reach the AppGraph server. Check the connection and retry.",
            retryable: true,
          },
        });
      }
    };

    const start = async () => {
      dispatch({ type: "analysis/start", url, owner: parsed.owner, repo: parsed.repo });
      try {
        const response = await fetch("/api/repositories/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });
        const data = (await response.json()) as { jobId?: string; error?: UserFacingError };
        if (!response.ok || !data.jobId) {
          dispatch({
            type: "analysis/error",
            error: data.error ?? {
              code: "INTERNAL",
              title: "Analysis failed",
              message: "The server could not start the analysis.",
              retryable: true,
            },
          });
          return;
        }
        if (cancelled) return;
        dispatch({ type: "analysis/queued", jobId: data.jobId });
        pollRef.current = setTimeout(() => poll(data.jobId as string), 350);
      } catch (error) {
        if (cancelled || (error as { name?: string }).name === "AbortError") return;
        dispatch({
          type: "analysis/error",
          error: {
            code: "GITHUB_UNAVAILABLE",
            title: "Connection lost",
            message: "Could not reach the AppGraph server. Check the connection and retry.",
            retryable: true,
          },
        });
      }
    };

    void start();

    return () => {
      cancelled = true;
      controller.abort();
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [url, parsed.owner, parsed.repo, loadPositionMap]);

  // React StrictMode double-invokes mount effects in development: the cleanup
  // aborts the first run and the second run must be allowed to start, otherwise
  // the client would never poll for the analysis result.
  useEffect(() => {
    const cleanup = runAnalysis();
    return cleanup;
  }, [runAnalysis]);

  const retryAnalysis = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    runAnalysis();
  }, [runAnalysis]);

  const setManualPosition = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      dispatch({ type: "positions/set", nodeId, position });
    },
    [],
  );

  const resetPositions = useCallback(() => dispatch({ type: "positions/reset" }), []);
  const toast = useCallback((message: string) => dispatch({ type: "ui/toast", message }), []);
  const openPalette = useCallback(() => dispatch({ type: "ui/palette", open: true }), []);
  const setExplorerTab = useCallback(
    (tab: ExplorerTab) => dispatch({ type: "ui/explorerTab", tab }),
    [],
  );

  const startTrace = useCallback(
    (setup: TraceSetup, options?: { playing?: boolean; tour?: TraceTour }) => {
      const graph = state.graph;
      if (graph) {
        const required = requiredGranularity(
          graph,
          setup.steps.flatMap((step) => step.nodeIds),
        );
        if (GRANULARITY_ORDER[required] > GRANULARITY_ORDER[state.granularity]) {
          dispatch({ type: "ui/granularity", granularity: required });
        }
      }
      dispatch({
        type: "trace/start",
        setup,
        playing: options?.playing ?? false,
        tour: options?.tour,
      });
    },
    [state.graph, state.granularity],
  );

  const startDownstream = useCallback(
    (nodeId: string) => {
      if (!state.graph) return;
      const setup = traceDownstream(state.graph, nodeId);
      if (!setup) {
        toast("No downstream connections detected for this entity");
        return;
      }
      startTrace(setup, { playing: true });
    },
    [state.graph, startTrace, toast],
  );

  const startImpact = useCallback(
    (nodeId: string) => {
      if (!state.graph) return;
      const setup = traceImpact(state.graph, nodeId);
      if (!setup) {
        toast("Nothing in the analyzed source depends on this entity");
        return;
      }
      startTrace(setup, { playing: true });
    },
    [state.graph, startTrace, toast],
  );

  const startPathPick = useCallback(
    (nodeId: string) => {
      dispatch({ type: "ui/pathPick", nodeId });
      toast("Now pick the destination entity");
    },
    [toast],
  );

  const startFlow = useCallback(
    (flow: DetectedFlow) => {
      if (!state.graph) return;
      startTrace(flowToTraceSetup(state.graph, flow), { playing: true });
    },
    [state.graph, startTrace],
  );

  const startTour = useCallback(() => {
    if (!state.graph) return;
    const tour = buildTour(state.graph);
    if (tour.setups.length === 0) {
      toast("No architecture flows were detected in this repository");
      return;
    }
    startTrace(tour.setups[0], {
      playing: true,
      tour: { title: tour.title, setups: tour.setups, index: 0 },
    });
    toast(`Architecture tour · ${tour.setups.length} flows`);
  }, [state.graph, startTrace, toast]);

  const stopTrace = useCallback(() => dispatch({ type: "trace/stop" }), []);
  const setTracePlaying = useCallback(
    (playing: boolean) => dispatch({ type: "trace/playing", playing }),
    [],
  );
  const advanceTrace = useCallback(() => dispatch({ type: "trace/advance" }), []);
  const prevTrace = useCallback(() => dispatch({ type: "trace/prev" }), []);

  const selectNode = useCallback(
    (nodeId?: string) => {
      if (nodeId && state.pendingPathFrom && state.graph && nodeId !== state.pendingPathFrom) {
        const path = findPath(state.graph, state.pendingPathFrom, nodeId);
        dispatch({ type: "ui/pathPick" });
        if (path) {
          startTrace(pathToTraceSetup(state.graph, path, { title: "Relationship path" }), {
            playing: true,
          });
        } else {
          dispatch({ type: "ui/select", nodeId });
          toast("No connection path found between these entities");
        }
        return;
      }
      dispatch({ type: "ui/select", nodeId });
    },
    [state.pendingPathFrom, state.graph, startTrace, toast],
  );

  const copyShareLink = useCallback(() => {
    if (!state.graph) return;
    const shareUrl = `${window.location.origin}/github/${state.graph.repository.owner}/${state.graph.repository.name}?ref=${state.graph.commitSha.slice(0, 12)}`;
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => toast("Share link copied to clipboard"))
      .catch(() => toast("Could not copy link"));
  }, [state.graph, toast]);

  // Persist manual positions.
  useEffect(() => {
    if (!state.graph) return;
    const key = positionsStorageKey(state.graph.repository.owner, state.graph.repository.name, state.graph.commitSha);
    try {
      window.localStorage.setItem(key, JSON.stringify(state.manualPositions));
    } catch {
      // Storage may be unavailable (private mode); overrides stay in memory.
    }
  }, [state.graph, state.manualPositions]);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!state.toast) return;
    const timeout = setTimeout(() => dispatch({ type: "ui/toast" }), 2600);
    return () => clearTimeout(timeout);
  }, [state.toast]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      dispatch,
      runAnalysis: retryAnalysis,
      retryAnalysis,
      setManualPosition,
      resetPositions,
      copyShareLink,
      toast,
      selectNode,
      startTrace,
      startDownstream,
      startImpact,
      startPathPick,
      startFlow,
      startTour,
      stopTrace,
      setTracePlaying,
      advanceTrace,
      prevTrace,
      setExplorerTab,
      openPalette,
    }),
    [
      state,
      retryAnalysis,
      setManualPosition,
      resetPositions,
      copyShareLink,
      toast,
      selectNode,
      startTrace,
      startDownstream,
      startImpact,
      startPathPick,
      startFlow,
      startTour,
      stopTrace,
      setTracePlaying,
      advanceTrace,
      prevTrace,
      setExplorerTab,
      openPalette,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
