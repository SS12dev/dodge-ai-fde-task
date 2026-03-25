import { type Dispatch, type RefObject, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { GraphData, GraphNode } from '../lib/types';

export type HoveredNode = {
  id: string;
  label: string;
  table: string;
  colour: string;
  x: number;
  y: number;
};

export type LegendItem = {
  table: string;
  colour: string;
};

type UseGraphInteractionsResult = {
  containerRef: RefObject<HTMLDivElement | null>;
  hoveredNode: HoveredNode | null;
  selectedNode: GraphNode | null;
  selectedNodeId: string | null;
  tableLegendItems: LegendItem[];
  activeLegendTable: string | null;
  isQueryHighlightActive: boolean;
  isExpanded: boolean;
  setIsExpanded: Dispatch<SetStateAction<boolean>>;
  revealNeighbors: () => void;
  showFullGraph: () => void;
  toggleQueryHighlight: () => void;
  toggleLegendHighlight: (table: string) => void;
  zoomBy: (factor: number) => void;
};

const RESET_CLASSES =
  'selected neighbor faded hovered neighbor-pulse query-match query-path query-muted query-evidence-flash legend-match legend-muted';

function buildElements(graph: GraphData): cytoscape.ElementDefinition[] {
  return [
    ...graph.nodes.map((node) => ({
      classes: `table-${node.table.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
      data: {
        id: node.id,
        label: node.label,
        table: node.table,
        colour: node.colour ?? '#005f73',
      },
    })),
    ...graph.edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
      },
    })),
  ];
}

const CYTOSCAPE_STYLE = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'background-color': 'data(colour)',
      color: '#f8fafc',
      'font-size': '10px',
      'font-weight': 600,
      'text-wrap': 'ellipsis',
      'text-max-width': '110px',
      'text-outline-width': 2,
      'text-outline-color': '#16313c',
      'min-zoomed-font-size': 9,
      width: 26,
      height: 26,
      'border-width': 1,
      'border-color': '#d8ece6',
      'overlay-opacity': 0,
      'transition-property': 'background-color, border-color, border-width, width, height, opacity',
      'transition-duration': 200,
    },
  },
  {
    selector: 'node.selected',
    style: {
      'border-width': 4,
      'border-color': '#f3a712',
      width: 34,
      height: 34,
      'underlay-color': '#f3a712',
      'underlay-opacity': 0.18,
      'underlay-padding': 8,
    },
  },
  {
    selector: 'node.hovered',
    style: {
      'border-width': 3,
      'border-color': '#ffd166',
      'underlay-color': '#ffd166',
      'underlay-opacity': 0.12,
      'underlay-padding': 6,
    },
  },
  {
    selector: 'node.neighbor-pulse',
    style: {
      'underlay-color': '#8ecae6',
      'underlay-opacity': 0.24,
      'underlay-padding': 10,
    },
  },
  {
    selector: 'node.query-match',
    style: {
      'border-width': 4,
      'border-color': '#ff9f1c',
      'underlay-color': '#ff9f1c',
      'underlay-opacity': 0.24,
      'underlay-padding': 9,
    },
  },
  {
    selector: 'node.query-evidence-flash',
    style: {
      'border-width': 5,
      'border-color': '#ffe066',
      'underlay-color': '#ffe066',
      'underlay-opacity': 0.44,
      'underlay-padding': 14,
    },
  },
  {
    selector: 'node.legend-match',
    style: {
      'border-width': 4,
      'border-color': '#2a9d8f',
      'underlay-color': '#2a9d8f',
      'underlay-opacity': 0.25,
      'underlay-padding': 10,
    },
  },
  {
    selector: '.faded',
    style: {
      opacity: 0.12,
      'text-opacity': 0,
    },
  },
  {
    selector: '.legend-muted',
    style: {
      opacity: 0.08,
      'text-opacity': 0,
    },
  },
  {
    selector: '.query-muted',
    style: {
      opacity: 0.08,
      'text-opacity': 0,
    },
  },
  {
    selector: 'node.neighbor',
    style: {
      opacity: 1,
      'border-width': 2,
      'border-color': '#7bd389',
    },
  },
  {
    selector: 'edge',
    style: {
      width: 2,
      opacity: 0.45,
      'line-color': '#8ecae6',
      'target-arrow-color': '#8ecae6',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.8,
      label: 'data(label)',
      'font-size': '8px',
      color: '#486571',
      'text-background-color': '#f8fafc',
      'text-background-opacity': 0,
      'text-background-padding': '2px',
      'min-zoomed-font-size': 10,
      'text-opacity': 0,
      'curve-style': 'bezier',
      'control-point-step-size': 20,
    },
  },
  {
    selector: 'edge.neighbor',
    style: {
      opacity: 0.95,
      width: 3,
      'line-color': '#219ebc',
      'target-arrow-color': '#219ebc',
      'text-opacity': 1,
      'text-background-opacity': 0.85,
    },
  },
  {
    selector: 'edge.query-path',
    style: {
      opacity: 0.9,
      width: 3,
      'line-color': '#ff9f1c',
      'target-arrow-color': '#ff9f1c',
      'text-opacity': 1,
      'text-background-opacity': 0.82,
    },
  },
] satisfies cytoscape.StylesheetJson;

function focusNodeNeighborhood(cy: cytoscape.Core, nodeId: string, shouldFit: boolean): void {
  const selected = cy.getElementById(nodeId);
  if (selected.empty()) {
    return;
  }

  cy.elements().removeClass('selected neighbor faded');
  cy.elements().addClass('faded');

  const neighborhood = selected.closedNeighborhood();
  neighborhood.removeClass('faded');
  neighborhood.addClass('neighbor');
  neighborhood.nodes().flashClass('neighbor-pulse', 420);
  selected.removeClass('neighbor');
  selected.addClass('selected');

  if (!shouldFit) {
    return;
  }

  cy.animate(
    {
      fit: {
        eles: neighborhood,
        padding: 88,
      },
    },
    {
      duration: 250,
    },
  );
}

export function useGraphInteractions(graph: GraphData, queryMatchedNodeIds: string[]): UseGraphInteractionsResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isQueryHighlightActive, setIsQueryHighlightActive] = useState(false);
  const [activeLegendTable, setActiveLegendTable] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<HoveredNode | null>(null);

  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const selectedNode = selectedNodeId ? (nodeById.get(selectedNodeId) ?? null) : null;

  const tableLegendItems = useMemo(() => {
    const tableToColour = new Map<string, string>();
    for (const node of graph.nodes) {
      if (!tableToColour.has(node.table)) {
        tableToColour.set(node.table, node.colour ?? '#005f73');
      }
    }
    return Array.from(tableToColour.entries()).map(([table, colour]) => ({ table, colour }));
  }, [graph.nodes]);

  const clearGraphFocus = (shouldFit: boolean) => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    setIsQueryHighlightActive(false);
    setActiveLegendTable(null);
    setSelectedNodeId(null);
    setHoveredNode(null);

    cy.elements().removeClass(RESET_CLASSES);

    if (!shouldFit) {
      return;
    }

    cy.animate(
      {
        fit: {
          eles: cy.elements(),
          padding: 50,
        },
      },
      {
        duration: 250,
      },
    );
  };

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const container = containerRef.current;
    const cy = cytoscape({
      container,
      elements: buildElements(graph),
      style: CYTOSCAPE_STYLE,
      layout: {
        name: 'cose',
        animate: false,
        randomize: true,
        fit: true,
        padding: 50,
        nodeRepulsion: () => 10000,
        idealEdgeLength: () => 120,
        edgeElasticity: () => 90,
        componentSpacing: 100,
        nestingFactor: 1.1,
        gravity: 0.9,
        numIter: 1200,
      },
      minZoom: 0.08,
      maxZoom: 2.2,
      wheelSensitivity: 0.45,
    });

    cyRef.current = cy;
    setSelectedNodeId(null);

    const preventWheelScroll = (event: WheelEvent) => {
      event.preventDefault();
    };

    container.addEventListener('wheel', preventWheelScroll, { passive: false });
    container.style.cursor = 'grab';

    cy.on('tap', 'node', (event) => {
      const id = event.target.id();
      setHoveredNode(null);
      setSelectedNodeId(id);
      focusNodeNeighborhood(cy, id, false);
    });

    cy.on('mouseover', 'node', (event) => {
      const node = event.target;
      const renderedPosition = node.renderedPosition();
      container.style.cursor = 'crosshair';
      node.addClass('hovered');
      setHoveredNode({
        id: node.id(),
        label: node.data('label') as string,
        table: node.data('table') as string,
        colour: (node.data('colour') as string) ?? '#005f73',
        x: renderedPosition.x,
        y: renderedPosition.y,
      });
    });

    cy.on('mousemove', 'node', (event) => {
      const node = event.target;
      const renderedPosition = node.renderedPosition();
      setHoveredNode((previous) => {
        if (!previous || previous.id !== node.id()) {
          return previous;
        }
        return {
          ...previous,
          x: renderedPosition.x,
          y: renderedPosition.y,
        };
      });
    });

    cy.on('mouseout', 'node', (event) => {
      const node = event.target;
      container.style.cursor = 'grab';
      node.removeClass('hovered');
      setHoveredNode((previous) => (previous?.id === node.id() ? null : previous));
    });

    cy.on('tap', (event) => {
      if (event.target === cy) {
        clearGraphFocus(false);
      }
    });

    return () => {
      container.removeEventListener('wheel', preventWheelScroll);
      container.style.cursor = 'default';
      cyRef.current = null;
      cy.destroy();
    };
  }, [graph]);

  useEffect(() => {
    if (queryMatchedNodeIds.length > 0) {
      setIsQueryHighlightActive(true);
      setActiveLegendTable(null);
    }
  }, [queryMatchedNodeIds]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    cy.elements().removeClass('query-match query-path query-muted query-evidence-flash');

    if (!isQueryHighlightActive || queryMatchedNodeIds.length === 0) {
      return;
    }

    const matchedNodes = cy.nodes().filter((node) => queryMatchedNodeIds.includes(node.id()));
    const queryContext = matchedNodes.union(matchedNodes.closedNeighborhood());

    cy.elements().addClass('query-muted');
    queryContext.removeClass('query-muted');

    matchedNodes.addClass('query-match');
    matchedNodes.flashClass('query-evidence-flash', 540);
    queryContext.edges().addClass('query-path');
  }, [queryMatchedNodeIds, isQueryHighlightActive]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    cy.elements().removeClass('legend-match legend-muted');

    if (!activeLegendTable) {
      return;
    }

    const legendNodes = cy.nodes().filter((node) => node.data('table') === activeLegendTable);
    cy.elements().addClass('legend-muted');
    legendNodes.removeClass('legend-muted').addClass('legend-match');
    legendNodes.connectedEdges().removeClass('legend-muted');
  }, [activeLegendTable]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    const timer = globalThis.setTimeout(() => {
      cy.resize();
    }, 0);

    return () => globalThis.clearTimeout(timer);
  }, [isExpanded]);

  const revealNeighbors = () => {
    const cy = cyRef.current;
    if (!cy || !selectedNodeId) {
      return;
    }
    focusNodeNeighborhood(cy, selectedNodeId, true);
  };

  const showFullGraph = () => {
    clearGraphFocus(true);
  };

  const toggleQueryHighlight = () => {
    setActiveLegendTable(null);
    setIsQueryHighlightActive((previous) => !previous);
  };

  const toggleLegendHighlight = (table: string) => {
    setSelectedNodeId(null);
    setHoveredNode(null);
    setIsQueryHighlightActive(false);
    cyRef.current?.elements().removeClass('selected neighbor faded hovered neighbor-pulse');
    setActiveLegendTable((previous) => (previous === table ? null : table));
  };

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    const nextZoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
    cy.animate({ zoom: nextZoom }, { duration: 180 });
  };

  return {
    containerRef,
    hoveredNode,
    selectedNode,
    selectedNodeId,
    tableLegendItems,
    activeLegendTable,
    isQueryHighlightActive,
    isExpanded,
    setIsExpanded,
    revealNeighbors,
    showFullGraph,
    toggleQueryHighlight,
    toggleLegendHighlight,
    zoomBy,
  };
}
