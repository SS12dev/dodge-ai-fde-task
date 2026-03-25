import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { GraphData, GraphNode } from '../lib/types';

type GraphViewProps = {
  graph: GraphData;
};

export function GraphView({ graph }: Readonly<GraphViewProps>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const selectedNode: GraphNode | null = selectedNodeId ? (nodeById.get(selectedNodeId) ?? null) : null;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...graph.nodes.map((n) => ({
          data: { id: n.id, label: `${n.table} | ${n.label}`, colour: n.colour ?? '#005f73' },
        })),
        ...graph.edges.map((e) => ({
          data: { id: e.id, source: e.source, target: e.target, label: e.label },
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'background-color': 'data(colour)',
            color: '#f1faee',
            'font-size': '9px',
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            width: 20,
            height: 20,
          },
        },
        {
          selector: 'node.selected',
          style: {
            'border-width': 3,
            'border-color': '#ffb703',
            width: 24,
            height: 24,
          },
        },
        {
          selector: '.faded',
          style: {
            opacity: 0.2,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#94d2bd',
            'target-arrow-color': '#94d2bd',
            'target-arrow-shape': 'triangle',
            label: 'data(label)',
            'font-size': '8px',
            color: '#0a9396',
            'curve-style': 'bezier',
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
      },
    });

    cyRef.current = cy;
    setSelectedNodeId(null);

    cy.on('tap', 'node', (event) => {
      const id = event.target.id();
      setSelectedNodeId(id);

      cy.elements().removeClass('selected');
      event.target.addClass('selected');
    });

    return () => {
      cyRef.current = null;
      cy.destroy();
    };
  }, [graph]);

  const revealNeighbors = () => {
    if (!cyRef.current || !selectedNodeId) {
      return;
    }
    const cy = cyRef.current;
    const selected = cy.getElementById(selectedNodeId);
    if (!selected || selected.empty()) {
      return;
    }

    cy.elements().addClass('faded');
    const neighborhood = selected.closedNeighborhood();
    neighborhood.removeClass('faded');
  };

  const showFullGraph = () => {
    if (!cyRef.current) {
      return;
    }
    cyRef.current.elements().removeClass('faded');
  };

  return (
    <section className="pane graph-pane">
      <h2>Graph Explorer</h2>
      <div className="graph-toolbar">
        <button type="button" onClick={revealNeighbors} disabled={!selectedNodeId}>
          Reveal Neighbors
        </button>
        <button type="button" onClick={showFullGraph}>
          Show Full Graph
        </button>
      </div>
      <div ref={containerRef} className="graph-canvas" />
      <div className="node-details">
        <h3>Node Metadata</h3>
        {selectedNode ? (
          <>
            <p>
              <strong>{selectedNode.table}</strong> / {selectedNode.label}
            </p>
            <pre>{JSON.stringify(selectedNode.data, null, 2)}</pre>
          </>
        ) : (
          <p>Select a node in the graph to inspect its metadata.</p>
        )}
      </div>
    </section>
  );
}
