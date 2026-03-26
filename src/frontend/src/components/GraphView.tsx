import { useState, useEffect } from 'react';
import type { GraphData, GraphNode } from '../lib/types';
import type { GraphMode } from '../lib/api';
import { type HoveredNode, type LegendItem, useGraphInteractions } from './useGraphInteractions';

type GraphViewProps = {
  graph: GraphData;
  queryMatchedNodeIds?: string[];
  graphMode: GraphMode;
  isGraphLoading: boolean;
  onGraphModeChange: (mode: GraphMode) => void;
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
  onFocus: () => void;
  onReset: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
};

type GraphHudProps = {
  graphMode: GraphMode;
  onGraphModeChange: (mode: GraphMode) => void;
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

function LoadingSpinner() {
  return (
    <div className="graph-loading-overlay">
      <div className="graph-loading-spinner">
        <div className="spinner-ring" />
        <p className="graph-loading-text">Constructing knowledge graph...</p>
      </div>
    </div>
  );
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

  const stageOrder = ['Orders', 'Delivery', 'Billing', 'Finance', 'Other'];
  const grouped = stageOrder
    .map((stage) => ({
      stage,
      items: items
        .filter((item) => item.stage === stage)
        .sort((left, right) => left.table.localeCompare(right.table)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="graph-legend" aria-label="Graph node colour legend">
      <p className="graph-legend-title">Entity Legend</p>
      <div className="graph-legend-list">
        {grouped.map((group) => (
          <section key={group.stage} className="graph-legend-stage">
            <p className="graph-legend-stage-title">{group.stage}</p>
            {group.items.map((item) => (
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
          </section>
        ))}
      </div>
    </aside>
  );
}

function GraphHud({ graphMode, onGraphModeChange }: Readonly<GraphHudProps>) {
  return (
    <div className="graph-hud">
      <div className="graph-hud-header-row">
        <h1>Dodge AI O2C Context Graph</h1>
      </div>
      <div className="graph-mode-switch" aria-label="Graph mode">
        <button
          type="button"
          className={`graph-mode-btn${graphMode === 'fast' ? ' is-active' : ''}`}
          onClick={() => onGraphModeChange('fast')}
          title="Faster load with a curated connected view"
        >
          Fast
        </button>
        <button
          type="button"
          className={`graph-mode-btn${graphMode === 'full' ? ' is-active' : ''}`}
          onClick={() => onGraphModeChange('full')}
          title="Full unfiltered graph payload"
        >
          Full
        </button>
      </div>
    </div>
  );
}

function GraphToolbar({
  hasSelection,
  onFocus,
  onReset,
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
        Reset
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
  if (!selectedNode) {
    return null;
  }

  const metadataPreview = selectedNode ? Object.entries(selectedNode.data).slice(0, 8) : [];

  return (
    <aside className="graph-card graph-popup">
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
          Close
        </button>
      </div>
      <p className="graph-card-copy">Connected neighbors stay highlighted so the local document path remains visible.</p>
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
    </aside>
  );
}

export function GraphView({
  graph,
  queryMatchedNodeIds = [],
  graphMode,
  isGraphLoading,
  onGraphModeChange,
}: Readonly<GraphViewProps>) {
  const [isConstructing, setIsConstructing] = useState(true);

  // Track when graph construction completes
  useEffect(() => {
    if ((graph?.nodes?.length ?? 0) > 0) {
      // Use setTimeout to ensure layout calculation is complete
      const timer = setTimeout(() => setIsConstructing(false), 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [graph]);

  const {
    containerRef,
    hoveredNode,
    selectedNode,
    selectedNodeId,
    tableLegendItems,
    activeLegendTable,
    isQueryHighlightActive,
    revealNeighbors,
    showFullGraph,
    toggleQueryHighlight,
    toggleLegendHighlight,
    zoomBy,
  } = useGraphInteractions(graph, queryMatchedNodeIds);

  const isSpotlightActive = Boolean(selectedNodeId || isQueryHighlightActive || activeLegendTable);

  return (
    <section className="graph-workspace">
      {(isGraphLoading || isConstructing) && <LoadingSpinner />}
      <QueryEvidenceNotice
        count={queryMatchedNodeIds.length}
        isActive={isQueryHighlightActive}
        onToggle={toggleQueryHighlight}
      />
      <div className={`graph-stage${isSpotlightActive ? ' spotlight-active' : ''}`}>
        <div ref={containerRef} className="graph-canvas" />
        <div className="graph-top-left-stack">
          <GraphHud graphMode={graphMode} onGraphModeChange={onGraphModeChange} />
          <GraphToolbar
            hasSelection={Boolean(selectedNodeId)}
            onFocus={revealNeighbors}
            onReset={showFullGraph}
            onZoomOut={() => zoomBy(0.82)}
            onZoomIn={() => zoomBy(1.22)}
          />
        </div>
        <LegendPanel items={tableLegendItems} activeTable={activeLegendTable} onToggle={toggleLegendHighlight} />
        {hoveredNode ? <HoverCard hoveredNode={hoveredNode} /> : null}
        <NodeDetailCard selectedNode={selectedNode} onClear={showFullGraph} />
      </div>
    </section>
  );
}
