import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { GraphView } from './components/GraphView';
import { fetchGraph, ingestData } from './lib/api';
import type { GraphData } from './lib/types';
import './App.css';

function App() {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [status, setStatus] = useState<string>('Loading graph...');
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
    return [...byTable.entries()].map(([table, count]) => `${table}: ${count}`).join(' | ');
  }, [graph]);

  return (
    <main className="layout">
      <header className="header">
        <h1>Dodge AI Context Graph</h1>
        <p>{status}</p>
        <p className="summary">{graphSummary}</p>
      </header>
      <section className="panes">
        <GraphView graph={graph} />
        <ChatPanel />
      </section>
    </main>
  );
}

export default App;
