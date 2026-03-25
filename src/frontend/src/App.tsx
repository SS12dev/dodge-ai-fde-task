import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { GraphView } from './components/GraphView';
import { fetchGraph, ingestData } from './lib/api';
import type { GraphData, QueryResponse } from './lib/types';
import './App.css';

type HeaderSummaryProps = {
  status: string;
  nodeCount: number;
  edgeCount: number;
  graphSummary: Array<[string, number]>;
};

function HeaderIntro() {
  return (
    <section className="top-panel top-panel-intro">
      <p className="eyebrow">Analyst Workbench</p>
      <h1>Dodge AI O2C Context Graph</h1>
      <p className="header-description">
        Investigate document flow, inspect connected ERP entities, and run grounded natural-language
        questions against the SAP order-to-cash dataset.
      </p>
    </section>
  );
}

function HeaderSummary({ status, nodeCount, edgeCount, graphSummary }: Readonly<HeaderSummaryProps>) {
  return (
    <section className="top-panel top-panel-status">
      <p className="status-pill">{status}</p>
      <div className="summary-grid">
        <article>
          <span className="summary-label">Entities</span>
          <strong>{nodeCount}</strong>
        </article>
        <article>
          <span className="summary-label">Relationships</span>
          <strong>{edgeCount}</strong>
        </article>
        {graphSummary.map(([table, count]) => (
          <article key={table}>
            <span className="summary-label">{table}</span>
            <strong>{count}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

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
  const [status, setStatus] = useState<string>('Loading graph...');
  const [queryMatchedNodeIds, setQueryMatchedNodeIds] = useState<string[]>([]);
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) {
      return;
    }
    bootstrapped.current = true;

    const bootstrap = async () => {
      let ingestWarning = false;
      try {
        await ingestData();
      } catch (err) {
        ingestWarning = true;
        console.warn('Dataset ingest on startup failed; attempting to load existing graph.', err);
      }

      try {
        const nextGraph = await fetchGraph();
        setGraph(nextGraph);
        const prefix = ingestWarning ? 'Loaded existing graph after ingest warning.' : 'Loaded';
        setStatus(`${prefix} ${nextGraph.nodes.length} nodes and ${nextGraph.edges.length} edges`);
      } catch (err) {
        setStatus('Graph load failed. Make sure backend is running and dataset files are available in /data.');
        console.error(err);
      }
    };
    bootstrap();
  }, []);

  const graphSummary = useMemo(() => {
    const byTable = new Map<string, number>();
    for (const node of graph.nodes) {
      byTable.set(node.table, (byTable.get(node.table) ?? 0) + 1);
    }
    return [...byTable.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4);
  }, [graph]);

  const handleQueryResult = (_question: string, response: QueryResponse) => {
    const matched = deriveMatchedNodes(graph, response);
    setQueryMatchedNodeIds(matched);
  };

  return (
    <main className="layout">
      <section className="top-strip">
        <HeaderIntro />
        <HeaderSummary
          status={status}
          nodeCount={graph.nodes.length}
          edgeCount={graph.edges.length}
          graphSummary={graphSummary}
        />
      </section>
      <section className="panes">
        <GraphView graph={graph} queryMatchedNodeIds={queryMatchedNodeIds} />
        <ChatPanel onQueryResult={handleQueryResult} />
      </section>
    </main>
  );
}

export default App;
