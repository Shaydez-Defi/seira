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
  /**
   * Units of the "to" asset received per one unit of the "from" asset.
   */
  rate: number;
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
  estimatedPayerAmount: string;
  steps: ExecutionStep[];
}

export interface QuoteResponse {
  fromAsset: string;
  toAsset: string;
  amountIn: string;
  amountOut: string;
  adapter: string;
}
