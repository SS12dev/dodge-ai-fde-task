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
  stage: BusinessStage;
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

type BusinessStage = 'Orders' | 'Delivery' | 'Billing' | 'Finance' | 'Other';

const STAGE_BASE_COLOURS: Record<BusinessStage, string> = {
  Orders: '#4f83c2',
  Delivery: '#49a487',
  Billing: '#c99054',
  Finance: '#8b79be',
  Other: '#6e7e95',
};

const STAGE_EDGE_COLOURS: Record<BusinessStage, string> = {
  Orders: '#6e98c7',
  Delivery: '#66b79e',
  Billing: '#d5a879',
  Finance: '#a794d2',
  Other: '#8695ac',
};

function inferBusinessStage(table: string): BusinessStage {
  if (table.startsWith('sales_order') || table === 'products' || table === 'business_partners') {
    return 'Orders';
  }
  if (table.startsWith('outbound_delivery')) {
    return 'Delivery';
  }
  if (table.startsWith('billing_document')) {
    return 'Billing';
  }
  if (table.startsWith('journal_entry') || table.startsWith('payments')) {
    return 'Finance';
  }
  return 'Other';
}

function tintHex(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const red = Math.max(0, Math.min(255, Number.parseInt(value.slice(0, 2), 16) + amount));
  const green = Math.max(0, Math.min(255, Number.parseInt(value.slice(2, 4), 16) + amount));
  const blue = Math.max(0, Math.min(255, Number.parseInt(value.slice(4, 6), 16) + amount));
  return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
}

function colourForTable(table: string): string {
  const base = STAGE_BASE_COLOURS[inferBusinessStage(table)];
  let hash = 0;
  for (let index = 0; index < table.length; index += 1) {
    hash = (hash * 31 + (table.codePointAt(index) ?? 0)) >>> 0;
  }
  const variation = (hash % 3 - 1) * 10;
  return tintHex(base, variation);
}

function buildElements(graph: GraphData): cytoscape.ElementDefinition[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  return [
    ...graph.nodes.map((node) => ({
      classes: `table-${node.table.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
      data: {
        id: node.id,
        label: node.label,
        table: node.table,
        colour: colourForTable(node.table),
        stage: inferBusinessStage(node.table),
      },
    })),
    ...graph.edges.map((edge) => {
      const sourceTable = nodeById.get(edge.source)?.table ?? '';
      const edgeStage = inferBusinessStage(sourceTable);
      return {
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          edgeColour: STAGE_EDGE_COLOURS[edgeStage],
        },
      };
    }),
  ];
}

const CYTOSCAPE_STYLE = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'background-color': 'data(colour)',
      color: '#e7eef7',
      'font-size': '8px',
      'font-weight': 600,
      'text-wrap': 'ellipsis',
      'text-max-width': '96px',
      'text-outline-width': 1,
      'text-outline-color': '#1a2a3b',
      'min-zoomed-font-size': 12,
      width: 24,
      height: 24,
      'border-width': 1,
      'border-color': '#90a7bf',
      'text-opacity': 0.35,
      'overlay-opacity': 0,
      'transition-property': 'background-color, border-color, border-width, width, height, opacity',
      'transition-duration': 200,
    },
  },
  {
    selector: 'node.selected',
    style: {
      'border-width': 4,
      'border-color': '#63b4ff',
      width: 32,
      height: 32,
      'underlay-color': '#63b4ff',
      'underlay-opacity': 0.2,
      'underlay-padding': 8,
      'text-opacity': 1,
    },
  },
  {
    selector: 'node.hovered',
    style: {
      'border-width': 3,
      'border-color': '#7dc3ff',
      'underlay-color': '#7dc3ff',
      'underlay-opacity': 0.14,
      'underlay-padding': 6,
      'text-opacity': 1,
    },
  },
  {
    selector: 'node.neighbor-pulse',
    style: {
      'underlay-color': '#7bb8ff',
      'underlay-opacity': 0.22,
      'underlay-padding': 10,
    },
  },
  {
    selector: 'node.query-match',
    style: {
      'border-width': 4,
      'border-color': '#ffd06a',
      'underlay-color': '#ffd06a',
      'underlay-opacity': 0.24,
      'underlay-padding': 9,
      'text-opacity': 1,
    },
  },
  {
    selector: 'node.query-evidence-flash',
    style: {
      'border-width': 5,
      'border-color': '#ffe5a0',
      'underlay-color': '#ffe5a0',
      'underlay-opacity': 0.36,
      'underlay-padding': 14,
    },
  },
  {
    selector: 'node.legend-match',
    style: {
      'border-width': 4,
      'border-color': '#71b8ff',
      'underlay-color': '#71b8ff',
      'underlay-opacity': 0.22,
      'underlay-padding': 10,
      'text-opacity': 1,
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
      'border-color': '#9ed2ff',
      'text-opacity': 1,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1.6,
      opacity: 0.4,
      'line-color': 'data(edgeColour)',
      'target-arrow-color': 'data(edgeColour)',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.7,
      label: 'data(label)',
      'font-size': '8px',
      color: '#b5c5d8',
      'text-background-color': '#1b2839',
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
      opacity: 0.92,
      width: 2.8,
      'line-color': '#7fc2ff',
      'target-arrow-color': '#7fc2ff',
      'text-opacity': 1,
      'text-background-opacity': 0.82,
    },
  },
  {
    selector: 'edge.query-path',
    style: {
      opacity: 0.9,
      width: 3,
      'line-color': '#ffd06a',
      'target-arrow-color': '#ffd06a',
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
    const tableToMeta = new Map<string, { colour: string; stage: BusinessStage }>();
    for (const node of graph.nodes) {
      if (!tableToMeta.has(node.table)) {
        tableToMeta.set(node.table, {
          colour: colourForTable(node.table),
          stage: inferBusinessStage(node.table),
        });
      }
    }
    return Array.from(tableToMeta.entries()).map(([table, meta]) => ({
      table,
      colour: meta.colour,
      stage: meta.stage,
    }));
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
        randomize: false,
        fit: true,
        padding: 50,
        nodeRepulsion: () => 22000,
        idealEdgeLength: () => 165,
        edgeElasticity: () => 70,
        componentSpacing: 170,
        nestingFactor: 1.1,
        gravity: 0.45,
        numIter: 700,
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
