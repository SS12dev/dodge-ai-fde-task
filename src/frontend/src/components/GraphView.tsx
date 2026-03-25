import type { GraphData, GraphNode } from '../lib/types';
import { type HoveredNode, type LegendItem, useGraphInteractions } from './useGraphInteractions';

type GraphViewProps = {
  graph: GraphData;
  queryMatchedNodeIds?: string[];
};

type QueryEvidenceNoticeProps = {
  count: number;
  isActive: boolean;
  onToggle: () => void;
};

type LegendPanelProps = {
  items: LegendItem[];
  activeTable: string | null;
  onToggle: (table: string) => void;
};

type GraphToolbarProps = {
  hasSelection: boolean;
  isExpanded: boolean;
  onFocus: () => void;
  onReset: () => void;
  onToggleExpand: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
};

type HoverCardProps = {
  hoveredNode: HoveredNode;
};

type NodeDetailCardProps = {
  selectedNode: GraphNode | null;
  onClear: () => void;
};

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  return JSON.stringify(value);
}

function QueryEvidenceNotice({ count, isActive, onToggle }: Readonly<QueryEvidenceNoticeProps>) {
  if (count === 0) {
    return null;
  }

  return (
    <p className="query-evidence-note">
      Query evidence: highlighting {count} matched node{count === 1 ? '' : 's'} from the latest result set.
      <button type="button" className="query-evidence-toggle" onClick={onToggle}>
        {isActive ? 'Hide' : 'Show'}
      </button>
    </p>
  );
}

function LegendPanel({ items, activeTable, onToggle }: Readonly<LegendPanelProps>) {
  if (items.length === 0) {
    return null;
  }

  return (
    <aside className="graph-legend" aria-label="Graph node colour legend">
      <p className="graph-legend-title">Entity Legend</p>
      <div className="graph-legend-list">
        {items.map((item) => (
          <button
            key={item.table}
            type="button"
            className={`graph-legend-item${activeTable === item.table ? ' is-active' : ''}`}
            onClick={() => onToggle(item.table)}
            title={`Highlight all ${item.table} nodes`}
          >
            <span className="graph-colour-dot" style={{ backgroundColor: item.colour }} />
            {item.table}
          </button>
        ))}
      </div>
    </aside>
  );
}

function GraphToolbar({
  hasSelection,
  isExpanded,
  onFocus,
  onReset,
  onToggleExpand,
  onZoomOut,
  onZoomIn,
}: Readonly<GraphToolbarProps>) {
  return (
    <div className="graph-toolbar graph-toolbar-floating">
      <button
        type="button"
        className="graph-toolbar-mini"
        onClick={onFocus}
        disabled={!hasSelection}
        aria-label="Focus selection"
        title="Focus selection"
      >
        Fit
      </button>
      <button
        type="button"
        className="graph-toolbar-mini"
        onClick={onReset}
        aria-label="Reset graph view"
        title="Reset graph view"
      >
        All
      </button>
      <button
        type="button"
        className="graph-toolbar-mini"
        onClick={onToggleExpand}
        aria-label={isExpanded ? 'Close expanded graph' : 'Open expanded graph'}
        title={isExpanded ? 'Close expanded graph' : 'Open expanded graph'}
      >
        {isExpanded ? 'Close' : 'Expand'}
      </button>
      <button
        type="button"
        className="graph-toolbar-icon"
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        -
      </button>
      <button type="button" className="graph-toolbar-icon" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
        +
      </button>
    </div>
  );
}

function HoverCard({ hoveredNode }: Readonly<HoverCardProps>) {
  return (
    <div className="graph-hover-card" style={{ left: `${hoveredNode.x + 16}px`, top: `${hoveredNode.y + 16}px` }}>
      <span className="graph-colour-dot" style={{ backgroundColor: hoveredNode.colour }} />
      <p className="graph-hover-eyebrow">{hoveredNode.table}</p>
      <strong>{hoveredNode.label}</strong>
    </div>
  );
}

function NodeDetailCard({ selectedNode, onClear }: Readonly<NodeDetailCardProps>) {
  const metadataPreview = selectedNode ? Object.entries(selectedNode.data).slice(0, 8) : [];

  return (
    <aside className={`graph-card${selectedNode ? ' is-visible' : ''}`}>
      {selectedNode ? (
        <>
          <div className="graph-card-header">
            <div>
              <p className="graph-card-eyebrow">{selectedNode.table}</p>
              <span
                className="graph-colour-dot graph-colour-dot-inline"
                style={{ backgroundColor: selectedNode.colour ?? '#005f73' }}
              />
              <h3>{selectedNode.label}</h3>
            </div>
            <button type="button" className="graph-card-close" onClick={onClear}>
              Clear
            </button>
          </div>
          <p className="graph-card-copy">Neighbors are highlighted automatically when you select a node.</p>
          <dl className="graph-card-grid">
            <div>
              <dt>Node ID</dt>
              <dd>{selectedNode.id}</dd>
            </div>
            <div>
              <dt>Entity Type</dt>
              <dd>{selectedNode.table}</dd>
            </div>
            {metadataPreview.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{formatMetadataValue(value)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <>
          <p className="graph-card-eyebrow">Quick Inspect</p>
          <h3>Select a node</h3>
          <p className="graph-card-copy">
            Clicking any entity opens its detail card here and highlights its local business context in the graph.
          </p>
        </>
      )}
    </aside>
  );
}

export function GraphView({ graph, queryMatchedNodeIds = [] }: Readonly<GraphViewProps>) {
  const {
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
  } = useGraphInteractions(graph, queryMatchedNodeIds);

  const isSpotlightActive = Boolean(selectedNodeId || isQueryHighlightActive || activeLegendTable);

  return (
    <section className="pane graph-pane">
      <h2>Graph Explorer</h2>
      <p className="pane-intro">Select an entity to inspect metadata and isolate its local order-to-cash neighborhood.</p>
      <QueryEvidenceNotice
        count={queryMatchedNodeIds.length}
        isActive={isQueryHighlightActive}
        onToggle={toggleQueryHighlight}
      />
      <div className={`graph-stage${isSpotlightActive ? ' spotlight-active' : ''}${isExpanded ? ' is-expanded' : ''}`}>
        <div ref={containerRef} className="graph-canvas" />
        <LegendPanel items={tableLegendItems} activeTable={activeLegendTable} onToggle={toggleLegendHighlight} />
        <GraphToolbar
          hasSelection={Boolean(selectedNodeId)}
          isExpanded={isExpanded}
          onFocus={revealNeighbors}
          onReset={showFullGraph}
          onToggleExpand={() => setIsExpanded((previous) => !previous)}
          onZoomOut={() => zoomBy(0.82)}
          onZoomIn={() => zoomBy(1.22)}
        />
        {hoveredNode ? <HoverCard hoveredNode={hoveredNode} /> : null}
        <NodeDetailCard selectedNode={selectedNode} onClear={showFullGraph} />
      </div>
    </section>
  );
}
