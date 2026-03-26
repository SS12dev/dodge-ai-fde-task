import { useEffect, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { GraphView } from './components/GraphView';
import { fetchGraph, type GraphMode, ingestData } from './lib/api';
import type { GraphData, QueryResponse } from './lib/types';
import './App.css';

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function getTokenFromValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      return null;
    }
    if (/^\d+$/.test(trimmed) && trimmed.length < 4) {
      return null;
    }
    return normalizeToken(trimmed);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const asInteger = Math.trunc(value);
    if (Math.abs(asInteger) < 1000) {
      return null;
    }
    return `${asInteger}`;
  }

  if (typeof value === 'bigint') {
    const asString = `${value}`;
    return asString.length < 4 ? null : asString;
  }

  return null;
}

function collectResponseTokens(response: QueryResponse): Set<string> {
  const tokens = new Set<string>();
  for (const row of response.rows) {
    for (const value of Object.values(row)) {
      const token = getTokenFromValue(value);
      if (token) {
        tokens.add(token);
      }
    }
  }
  return tokens;
}

function collectNodeTokens(node: GraphData['nodes'][number]): Set<string> {
  const tokens = new Set<string>();

  const nodeIdToken = getTokenFromValue(node.id);
  const nodeLabelToken = getTokenFromValue(node.label);

  if (nodeIdToken) {
    tokens.add(nodeIdToken);
  }
  if (nodeLabelToken) {
    tokens.add(nodeLabelToken);
  }

  for (const value of Object.values(node.data)) {
    const token = getTokenFromValue(value);
    if (token) {
      tokens.add(token);
    }
  }

  return tokens;
}

function intersects(first: Set<string>, second: Set<string>): boolean {
  for (const value of first) {
    if (second.has(value)) {
      return true;
    }
  }
  return false;
}

function deriveMatchedNodes(graph: GraphData, response: QueryResponse): string[] {
  if (!response.ok || response.rows.length === 0) {
    return [];
  }

  const responseTokens = collectResponseTokens(response);
  if (responseTokens.size === 0) {
    return [];
  }

  const matched: string[] = [];

  for (const node of graph.nodes) {
    const nodeTokens = collectNodeTokens(node);
    if (intersects(nodeTokens, responseTokens)) {
      matched.push(node.id);
    }
  }

  return matched;
}

function App() {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [graphMode, setGraphMode] = useState<GraphMode>('fast');
  const [graphLoading, setGraphLoading] = useState(true);
  const [queryMatchedNodeIds, setQueryMatchedNodeIds] = useState<string[]>([]);

  useEffect(() => {
    const bootstrap = async () => {
      setGraphLoading(true);
      try {
        try {
          const nextGraph = await fetchGraph(graphMode);
          if (nextGraph.nodes.length > 0) {
            setGraph(nextGraph);
            return;
          }
        } catch (err) {
          console.warn('Graph not available yet; running ingest fallback.', err);
        }

        await ingestData();
        const nextGraph = await fetchGraph(graphMode);
        setGraph(nextGraph);
      } catch (err) {
        console.error('Failed to bootstrap graph.', err);
      } finally {
        setGraphLoading(false);
      }
    };
    bootstrap();
  }, [graphMode]);

  const onGraphModeChange = (mode: GraphMode) => {
    if (mode === graphMode) {
      return;
    }
    setGraphMode(mode);
  };

  const handleQueryResult = (_question: string, response: QueryResponse) => {
    const matched = deriveMatchedNodes(graph, response);
    setQueryMatchedNodeIds(matched);
  };

  return (
    <main className="app-shell">
      <GraphView
        graph={graph}
        queryMatchedNodeIds={queryMatchedNodeIds}
        graphMode={graphMode}
        isGraphLoading={graphLoading}
        onGraphModeChange={onGraphModeChange}
      />
      <ChatPanel onQueryResult={handleQueryResult} />
    </main>
  );
}

export default App;
