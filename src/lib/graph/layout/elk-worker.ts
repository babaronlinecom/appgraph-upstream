import { Worker } from "node:worker_threads";
import type { ElkNode } from "elkjs/lib/elk-api";

/**
 * Runs ELK in a worker thread with a hard timeout. The bundled elkjs engine is
 * synchronous and can block the event loop for minutes on dense graphs, which
 * previously made the whole API unresponsive and defeated the analysis timeout.
 * Isolation guarantees that a pathological layout degrades to the fallback
 * grid instead of hanging the server.
 */

const WORKER_CODE = `
const { parentPort, workerData } = require("node:worker_threads");
try {
  const elkPath = require.resolve("elkjs/lib/elk.bundled.js", { paths: [workerData.projectRoot] });
  const ELK = require(elkPath);
  const engine = new ELK();
  engine
    .layout(workerData.graph)
    .then((result) => parentPort.postMessage({ ok: true, result }))
    .catch((error) => parentPort.postMessage({ ok: false, error: String((error && error.message) || error) }));
} catch (error) {
  parentPort.postMessage({ ok: false, error: String((error && error.message) || error) });
}
`;

export interface WorkerLayoutResult {
  positions: Map<string, { x: number; y: number }>;
  degraded: boolean;
  error?: string;
}

export async function layoutWithWorker(graph: ElkNode, timeoutMs: number): Promise<WorkerLayoutResult> {
  const worker = new Worker(WORKER_CODE, {
    eval: true,
    workerData: { graph, projectRoot: process.cwd() },
  });

  try {
    const message = await new Promise<{ ok: boolean; result?: ElkNode; error?: string }>((resolve) => {
      let settled = false;
      const finish = (value: { ok: boolean; result?: ElkNode; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        void worker.terminate().catch(() => {});
        finish({ ok: false, error: `layout timeout after ${timeoutMs}ms` });
      }, timeoutMs);
      worker.once("message", (value: { ok: boolean; result?: ElkNode; error?: string }) => finish(value));
      worker.once("error", (error) => finish({ ok: false, error: String(error) }));
      worker.once("exit", (code) => {
        if (code !== 0) finish({ ok: false, error: `layout worker exited with code ${code}` });
      });
    });

    if (!message.ok || !message.result) {
      return { positions: new Map(), degraded: true, error: message.error };
    }

    const positions = new Map<string, { x: number; y: number }>();
    for (const child of message.result.children ?? []) {
      positions.set(child.id, { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) });
    }
    return { positions, degraded: false };
  } finally {
    void worker.terminate().catch(() => {});
  }
}
