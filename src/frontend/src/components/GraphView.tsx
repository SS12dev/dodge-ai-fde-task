import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { GraphData } from '../lib/types';

type GraphViewProps = {
  graph: GraphData;
};

export function GraphView({ graph }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...graph.nodes.map((n) => ({
          data: { id: n.id, label: `${n.table} | ${n.label}` },
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
            'background-color': '#005f73',
            color: '#f1faee',
            'font-size': '9px',
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            width: 20,
            height: 20,
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

    return () => {
      cy.destroy();
    };
  }, [graph]);

  return (
    <section className="pane graph-pane">
      <h2>Graph Explorer</h2>
      <div ref={containerRef} className="graph-canvas" />
    </section>
  );
}
