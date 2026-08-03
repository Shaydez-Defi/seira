export interface PaymentIntent {
  intent: "payment";
  payerAsset: string;
  receiverAsset: string;
  receiverAmount: string;
  recipient: string;
  constraints: {
    maxFee?: string;
    maxSlippage?: string;
    deadline?: number;
    priority?: "cost" | "speed" | "safety";
  };
}

export interface CapabilityEntry {
  pair: [string, string];
  adapter: string;
  action: "ConvertAsset" | "AcquireAsset" | "Bridge";
  cost: number;
  latencyMs: number;
  reliability: number;
  reversible: boolean;
  liquidityScore: number;
}

export interface ExecutionStep {
  stepId: number;
  action: "AcquireAsset" | "ConvertAsset" | "Transfer" | "VerifySettlement";
  from?: string;
  to?: string;
  asset?: string;
  preferredAdapter?: string;
  fallbackAdapters?: string[];
  properties?: {
    reversible?: boolean;
    estimatedSlippage?: string;
  };
}

export interface ExecutionPlan {
  planId: string;
  estimatedCost: string;
  estimatedTime: string;
  estimatedOutput: string;
  steps: ExecutionStep[];
}
