import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { runQuestion } from '../lib/api';
import type { QueryResponse } from '../lib/types';

type ChatPanelProps = {
  onQueryResult?: (question: string, response: QueryResponse) => void;
};

type ChatExchange = {
  id: string;
  question: string;
  response: QueryResponse;
};

const EXAMPLES = [
  'Which products are associated with the highest number of billing documents?',
  'Trace the full flow for billing document 10001234',
  'Identify sales orders that are delivered but not billed',
];


function toCellText(value: unknown): string {
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

type ResultTableProps = {
  rows: Record<string, unknown>[];
  totalRows: number;
  tableId: string;
  expandedTables: Set<string>;
  onToggleExpand: (tableId: string) => void;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string) => void;
};

function ResultTable({
  rows,
  totalRows,
  tableId,
  expandedTables,
  onToggleExpand,
  sortColumn,
  sortDirection,
  onSort,
}: Readonly<ResultTableProps>) {
  const tableColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const isExpanded = expandedTables.has(tableId);
  const displayRows = isExpanded ? rows : rows.slice(0, 5);

  if (rows.length === 0) {
    return <p>No rows returned.</p>;
  }

  const compareValues = (a: unknown, b: unknown): number => {
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;

    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b);
    }
    const aStr = toCellText(a);
    const bStr = toCellText(b);
    return aStr.localeCompare(bStr);
  };

  const sortedRows = [...displayRows];
  if (sortColumn && tableColumns.includes(sortColumn)) {
    sortedRows.sort((a, b) => {
      const comparison = compareValues(a[sortColumn], b[sortColumn]);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }

  return (
    <div className="rows-table-wrap rows-table-wrap-compact">
      <div className="rows-table-meta rows-table-meta-compact">
        <span>
          {isExpanded ? `Showing all ${totalRows}` : `Previewing ${displayRows.length} of ${totalRows}`} row{totalRows === 1 ? '' : 's'}
        </span>
        {totalRows > 5 ? (
          <button
            type="button"
            className="rows-table-expand-btn"
            onClick={() => onToggleExpand(tableId)}
          >
            {isExpanded ? 'Show preview' : 'Show all'}
          </button>
        ) : null}
      </div>
      <div className="rows-table-scroll">
        <table className="rows-table">
          <thead>
            <tr>
              {tableColumns.map((column) => (
                <th
                  key={column}
                  className={`rows-table-heading${sortColumn === column ? ' is-sorted' : ''}`}
                  onClick={() => onSort(column)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSort(column);
                    }
                  }}
                >
                  <span className="column-sort-label">
                    {column}
                    {sortColumn === column && <span className="sort-indicator">{sortDirection === 'asc' ? ' ↑' : ' ↓'}</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, index) => {
              const rowKey = `${index}-${JSON.stringify(row)}`;
              return (
                <tr key={rowKey}>
                  {tableColumns.map((column) => (
                    <td key={`${rowKey}-${column}`}>{toCellText(row[column])}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SqlPanel({ sql }: Readonly<{ sql: string }>) {
  return (
    <div className="sql-panel sql-panel-inline">
      <pre>{sql}</pre>
    </div>
  );
}

function buildExchangeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


export function ChatPanel({ onQueryResult }: Readonly<ChatPanelProps>) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [history, setHistory] = useState<ChatExchange[]>([]);
  const [expandedSqlIds, setExpandedSqlIds] = useState<string[]>([]);
  const [highlightedExchangeId, setHighlightedExchangeId] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [tableSortState, setTableSortState] = useState<{ tableId: string; column: string | null; direction: 'asc' | 'desc' }>({
    tableId: '',
    column: null,
    direction: 'asc',
  });
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);


  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ block: 'end' });
  }, [history, loading, drawerOpen, expandedSqlIds]);

  const runPrompt = async (prompt: string) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      return;
    }

    setLoading(true);
    setPendingQuestion(cleanPrompt);
    setDrawerOpen(true);

    try {
      const response = await runQuestion(cleanPrompt);
      const exchange = { id: buildExchangeId(), question: cleanPrompt, response };
      setHistory((previous) => [...previous, exchange]);
      setHighlightedExchangeId(exchange.id);
      onQueryResult?.(cleanPrompt, response);
    } catch (error) {
      const response: QueryResponse = {
        ok: false,
        error: error instanceof Error ? error.message : 'Query failed unexpectedly.',
        sql: '',
        rows: [],
      };
      const exchange = { id: buildExchangeId(), question: cleanPrompt, response };
      setHistory((previous) => [...previous, exchange]);
      setHighlightedExchangeId(exchange.id);
      onQueryResult?.(cleanPrompt, response);
    } finally {
      setQuestion('');
      setPendingQuestion(null);
      setLoading(false);
    }
  };

  const onSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    await runPrompt(question);
  };

  const onQuestionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void runPrompt(question);
    }
  };

  const toggleSql = (exchangeId: string) => {
    setExpandedSqlIds((previous) =>
      previous.includes(exchangeId) ? previous.filter((value) => value !== exchangeId) : [...previous, exchangeId],
    );
  };

  const toggleTableExpand = (tableId: string) => {
    setExpandedTables((previous) => {
      const next = new Set(previous);
      if (next.has(tableId)) {
        next.delete(tableId);
      } else {
        next.add(tableId);
      }
      return next;
    });
  };

  const handleTableSort = (tableId: string, column: string) => {
    setTableSortState((previous) => {
      if (previous.tableId === tableId && previous.column === column) {
        return {
          tableId,
          column,
          direction: previous.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return { tableId, column, direction: 'asc' };
    });
  };

  const highlightExchange = (exchange: ChatExchange) => {
    setHighlightedExchangeId(exchange.id);
    onQueryResult?.(exchange.question, exchange.response);
  };

  const clearChat = () => {
    setHistory([]);
    setExpandedSqlIds([]);
    setHighlightedExchangeId(null);
    setPendingQuestion(null);
    setExpandedTables(new Set());
    setTableSortState({ tableId: '', column: null, direction: 'asc' });
    onQueryResult?.('', { ok: true, sql: '', rows: [], answer: '' });
  };

  return (
    <>
      {drawerOpen ? null : (
        <button
          type="button"
          className="chat-drawer-toggle"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-controls="dodge-ai-chat-drawer"
        >
          Ask Dodge AI
        </button>
      )}

      <aside id="dodge-ai-chat-drawer" className={`chat-drawer${drawerOpen ? ' is-open' : ''}`} aria-label="Dodge AI chat">
        <div className="chat-drawer-header">
          <div>
            <h2>Dodge AI</h2>
          </div>
          <div className="chat-drawer-header-actions">
            <button type="button" className="chat-drawer-clear" onClick={clearChat} disabled={history.length === 0}>
              Clear chat
            </button>
            <button type="button" className="chat-drawer-close" onClick={() => setDrawerOpen(false)}>
              Close
            </button>
          </div>
        </div>

        <div className="chat-drawer-body">
          {history.length === 0 && !loading ? (
            <div className="chat-empty-state">
              <p className="chat-empty-title">Ask a dataset question to start the session.</p>
              <p className="chat-empty-copy">Conversations stay only for this browser session and disappear when the session ends.</p>
            </div>
          ) : null}

          {history.map((exchange) => {
            const rows = exchange.response.rows ?? [];
            const showSql = expandedSqlIds.includes(exchange.id);
            return (
              <div key={exchange.id} className="chat-exchange">
                <article className="chat-bubble chat-bubble-user">
                  <p>{exchange.question}</p>
                </article>
                <article className="chat-bubble chat-bubble-assistant">
                  {exchange.response.ok ? (
                    <p className="answer-copy answer-copy-compact">{exchange.response.answer}</p>
                  ) : (
                    <p className="error">{exchange.response.error}</p>
                  )}
                  <div className="chat-response-meta">
                    <span>{rows.length} row{rows.length === 1 ? '' : 's'}</span>
                    <button
                      type="button"
                      className={`chat-highlight-btn${highlightedExchangeId === exchange.id ? ' is-active' : ''}`}
                      onClick={() => highlightExchange(exchange)}
                    >
                      {highlightedExchangeId === exchange.id ? 'Highlighted' : 'Highlight'}
                    </button>
                  </div>
                  {rows.length > 0 ? (
                    <ResultTable
                      rows={rows}
                      totalRows={rows.length}
                      tableId={exchange.id}
                      expandedTables={expandedTables}
                      onToggleExpand={toggleTableExpand}
                      sortColumn={tableSortState.tableId === exchange.id ? tableSortState.column : null}
                      sortDirection={tableSortState.tableId === exchange.id ? tableSortState.direction : 'asc'}
                      onSort={(column) => handleTableSort(exchange.id, column)}
                    />
                  ) : null}
                  {exchange.response.sql ? (
                    <div className="chat-inline-sql">
                      <button type="button" className="chat-inline-sql-toggle" onClick={() => toggleSql(exchange.id)}>
                        {showSql ? 'Hide SQL' : 'Show SQL'}
                      </button>
                      {showSql ? <SqlPanel sql={exchange.response.sql} /> : null}
                    </div>
                  ) : null}
                </article>
              </div>
            );
          })}

          {loading && pendingQuestion ? (
            <div className="chat-exchange">
              <article className="chat-bubble chat-bubble-user">
                <p>{pendingQuestion}</p>
              </article>
              <article className="chat-bubble chat-bubble-assistant chat-bubble-loading">
                <p>Running the query and matching evidence in the graph...</p>
              </article>
            </div>
          ) : null}
          <div ref={scrollAnchorRef} />
        </div>

        <div className="chat-drawer-footer">
          <div className="chat-example-row">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="example-chip" onClick={() => runPrompt(example)} disabled={loading}>
                {example}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="chat-form chat-form-overlay">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={onQuestionKeyDown}
              placeholder="Ask about products, billing documents, document flow, broken orders..."
              rows={3}
            />
            <div className="chat-actions">
              <span className="chat-hint">Ctrl+Enter to send</span>
              <button type="submit" disabled={loading || !question.trim()}>
                {loading ? 'Running...' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      </aside>
    </>
  );
}
