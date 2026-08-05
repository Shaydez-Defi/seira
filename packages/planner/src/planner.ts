import { randomUUID } from "node:crypto";
import type {
  CapabilityEntry,
  ExecutionPlan,
  ExecutionStep,
  PaymentIntent,
} from "../../core/src/types";
import { CapabilityRegistry } from "../../registry/src/registry";

export interface ScoreWeights {
  cost: number;
  latency: number;
  reliability: number;
  reversibility: number;
  liquidityScore: number;
}

/** Hardcoded minimum viable liquidity for an edge to be considered. */
export const MIN_VIABLE_LIQUIDITY = 0.5;

/** Maximum number of conversion hops allowed in a route. */
export const MAX_PATH_HOPS = 3;

export const WEIGHT_PRESETS: Record<"cost" | "speed" | "safety", ScoreWeights> = {
  cost: { cost: 0.5, latency: 0.1, reliability: 0.2, reversibility: 0.1, liquidityScore: 0.1 },
  speed: { cost: 0.1, latency: 0.5, reliability: 0.2, reversibility: 0.1, liquidityScore: 0.1 },
  safety: { cost: 0.1, latency: 0.1, reliability: 0.35, reversibility: 0.35, liquidityScore: 0.1 },
};

export const DEFAULT_WEIGHTS: ScoreWeights = {
  cost: 0.2,
  latency: 0.2,
  reliability: 0.2,
  reversibility: 0.2,
  liquidityScore: 0.2,
};

/** Thrown when no feasible route exists between the intent's payer and receiver assets. */
export class NoFeasibleRouteError extends Error {}

interface PathMetrics {
  cost: number;
  latencyMs: number;
  reliability: number;
  liquidityScore: number;
  reversible: boolean;
  rate: number;
}

interface FeasiblePath {
  edges: CapabilityEntry[];
  metrics: PathMetrics;
  score: number;
}

type Adjacency = Map<string, Map<string, CapabilityEntry[]>>;

function aggregatePath(edges: CapabilityEntry[]): PathMetrics {
  let cost = 0;
  let latencyMs = 0;
  let reliability = 1;
  let liquidityScore = 1;
  let reversible = true;
  let rate = 1;
  for (const edge of edges) {
    cost += edge.cost;
    latencyMs += edge.latencyMs;
    reliability = Math.min(reliability, edge.reliability);
    liquidityScore = Math.min(liquidityScore, edge.liquidityScore);
    reversible = reversible && edge.reversible;
    rate *= edge.rate;
  }
  return { cost, latencyMs, reliability, liquidityScore, reversible, rate };
}

function buildAdjacency(registry: CapabilityRegistry): Adjacency {
  const adjacency: Adjacency = new Map();
  for (const pair of registry.getAllPairs()) {
    const capabilities = registry.getCapabilities(pair[0], pair[1]);
    if (capabilities.length === 0) {
      continue;
    }
    let fromNode = adjacency.get(pair[0]);
    if (fromNode === undefined) {
      fromNode = new Map();
      adjacency.set(pair[0], fromNode);
    }
    fromNode.set(pair[1], capabilities);
  }
  return adjacency;
}

function enumerateSimplePaths(
  adjacency: Adjacency,
  from: string,
  to: string,
  maxHops: number
): CapabilityEntry[][] {
  const paths: CapabilityEntry[][] = [];
  const visited = new Set<string>([from]);
  const current: CapabilityEntry[] = [];

  function visit(node: string): void {
    if (node === to) {
      paths.push([...current]);
      return;
    }
    if (current.length >= maxHops) {
      return;
    }
    const neighbors = adjacency.get(node);
    if (neighbors === undefined) {
      return;
    }
    for (const [nextAsset, edges] of neighbors) {
      if (visited.has(nextAsset)) {
        continue;
      }
      visited.add(nextAsset);
      for (const edge of edges) {
        current.push(edge);
        visit(nextAsset);
        current.pop();
      }
      visited.delete(nextAsset);
    }
  }

  visit(from);
  return paths;
}

function scorePath(edges: CapabilityEntry[], weights: ScoreWeights): number {
  const metrics = aggregatePath(edges);
  return (
    weights.cost * metrics.cost +
    weights.latency * (metrics.latencyMs / 1000) +
    weights.reliability * (1 - metrics.reliability) +
    weights.reversibility * (metrics.reversible ? 0 : 1) +
    weights.liquidityScore * (1 - metrics.liquidityScore)
  );
}

function parseMaxFee(maxFee: string): number {
  const parsed = Number.parseFloat(maxFee);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid maxFee in intent constraints: "${maxFee}"`);
  }
  return parsed;
}

function isPathFeasible(
  edges: CapabilityEntry[],
  metrics: PathMetrics,
  intent: PaymentIntent
): boolean {
  if (intent.constraints.maxFee !== undefined) {
    const maxFee = parseMaxFee(intent.constraints.maxFee);
    if (metrics.cost > maxFee) {
      return false;
    }
  }
  if (intent.constraints.deadline !== undefined) {
    const latencySeconds = metrics.latencyMs / 1000;
    const remainingSeconds =
      intent.constraints.deadline - Math.floor(Date.now() / 1000);
    if (remainingSeconds <= 0 || latencySeconds > remainingSeconds) {
      return false;
    }
  }
  if (edges.some((edge) => edge.liquidityScore < MIN_VIABLE_LIQUIDITY)) {
    return false;
  }
  return true;
}

function resolveWeights(priority: PaymentIntent["constraints"]["priority"]): ScoreWeights {
  if (priority === undefined) {
    return DEFAULT_WEIGHTS;
  }
  return WEIGHT_PRESETS[priority];
}

function resolveFallbackAdapters(
  registry: CapabilityRegistry,
  edge: CapabilityEntry,
  weights: ScoreWeights
): string[] {
  return registry
    .getCapabilities(edge.pair[0], edge.pair[1])
    .filter((candidate) => candidate.adapter !== edge.adapter)
    .sort((a, b) => scorePath([a], weights) - scorePath([b], weights))
    .map((candidate) => candidate.adapter);
}

function parseAmount(amount: string, label: string): number {
  const parsed = Number.parseFloat(amount);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${label} in intent: "${amount}"`);
  }
  return parsed;
}

function buildPlan(
  intent: PaymentIntent,
  path: FeasiblePath,
  registry: CapabilityRegistry,
  weights: ScoreWeights
): ExecutionPlan {
  const steps: ExecutionStep[] = [];

  steps.push({ stepId: 1, action: "AcquireAsset", asset: intent.payerAsset });

  let stepId = 2;
  for (const edge of path.edges) {
    steps.push({
      stepId,
      action: "ConvertAsset",
      from: edge.pair[0],
      to: edge.pair[1],
      asset: edge.pair[1],
      preferredAdapter: edge.adapter,
      fallbackAdapters: resolveFallbackAdapters(registry, edge, weights),
      properties: { reversible: edge.reversible },
    });
    stepId += 1;
  }

  steps.push({ stepId, action: "Transfer", asset: intent.receiverAsset, to: intent.recipient });
  stepId += 1;
  steps.push({ stepId, action: "VerifySettlement", asset: intent.receiverAsset });

  const receiverAmount = parseAmount(intent.receiverAmount, "receiverAmount");
  const payerAmount = receiverAmount / path.metrics.rate;

  return {
    planId: randomUUID(),
    estimatedCost: String(path.metrics.cost),
    estimatedTime: String(path.metrics.latencyMs),
    estimatedOutput: intent.receiverAmount,
    estimatedPayerAmount: String(payerAmount),
    steps,
  };
}

export class ExecutionPlanner {
  /**
   * Produces an execution plan for the intent using the lowest-scoring feasible route.
   */
  plan(intent: PaymentIntent, registry: CapabilityRegistry): ExecutionPlan {
    const weights = resolveWeights(intent.constraints.priority);
    const adjacency = buildAdjacency(registry);
    const paths = enumerateSimplePaths(
      adjacency,
      intent.payerAsset,
      intent.receiverAsset,
      MAX_PATH_HOPS
    );

    const feasible: FeasiblePath[] = [];
    for (const edges of paths) {
      const metrics = aggregatePath(edges);
      if (isPathFeasible(edges, metrics, intent)) {
        feasible.push({ edges, metrics, score: scorePath(edges, weights) });
      }
    }

    if (feasible.length === 0) {
      throw new NoFeasibleRouteError(
        `No feasible route from ${intent.payerAsset} to ${intent.receiverAsset}`
      );
    }

    feasible.sort((a, b) => a.score - b.score);
    return buildPlan(intent, feasible[0], registry, weights);
  }
}
