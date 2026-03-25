export type GraphNode = {
  id: string;
  table: string;
  label: string;
  data: Record<string, unknown>;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type QueryResponse = {
  ok: boolean;
  error?: string;
  answer?: string;
  sql: string;
  rows: Record<string, unknown>[];
};
