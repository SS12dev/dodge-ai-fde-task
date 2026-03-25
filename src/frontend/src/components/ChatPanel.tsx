import { type KeyboardEvent, type ReactNode, useMemo, useState } from 'react';
import { runQuestion } from '../lib/api';
import type { QueryResponse } from '../lib/types';

type ChatPanelProps = {
  onQueryResult?: (question: string, response: QueryResponse) => void;
};

type ResultSection = 'results' | 'sql';
type SortDirection = 'asc' | 'desc';
type SortState = {
  column: string;
  direction: SortDirection;
} | null;

const EXAMPLES = [
  'Which products are associated with the highest number of billing documents?',
  'Trace the full flow for billing document 10001234',
  'Identify sales orders that are delivered but not billed',
];

const PINNED_PROMPTS_STORAGE_KEY = 'dodgeai.pinnedPrompts';

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

function compareValues(left: unknown, right: unknown, direction: SortDirection): number {
  const leftText = toCellText(left);
  const rightText = toCellText(right);

  const leftNumeric = Number(leftText);
  const rightNumeric = Number(rightText);
  const bothNumeric = Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric);

  let comparison = 0;
  if (bothNumeric) {
    comparison = leftNumeric - rightNumeric;
  } else {
    comparison = leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: 'base' });
  }

  return direction === 'asc' ? comparison : -comparison;
}

function ResultTable({ rows }: Readonly<{ rows: Record<string, unknown>[] }>) {
  const tableColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const [showAllRows, setShowAllRows] = useState(false);
  const [sortState, setSortState] = useState<SortState>(null);

  const previewCount = 12;
  const sortedRows = useMemo(() => {
    if (!sortState) {
      return rows;
    }

    const nextRows = [...rows];
    nextRows.sort((left, right) => compareValues(left[sortState.column], right[sortState.column], sortState.direction));
    return nextRows;
  }, [rows, sortState]);

  const visibleRows = showAllRows ? sortedRows : sortedRows.slice(0, previewCount);

  const toggleSort = (column: string) => {
    setSortState((previous) => {
      if (previous?.column !== column) {
        return { column, direction: 'asc' };
      }
      if (previous.direction === 'asc') {
        return { column, direction: 'desc' };
      }
      return null;
    });
  };

  const sortMarker = (column: string) => {
    if (sortState?.column !== column) {
      return '';
    }
    return sortState.direction === 'asc' ? ' ▲' : ' ▼';
  };

  if (rows.length === 0) {
    return <p>No rows returned.</p>;
  }

  return (
    <div className="rows-table-wrap">
      <div className="rows-table-meta">
        <span>
          Showing {visibleRows.length} of {rows.length} row{rows.length === 1 ? '' : 's'}
        </span>
        {rows.length > previewCount ? (
          <button type="button" className="rows-toggle" onClick={() => setShowAllRows((previous) => !previous)}>
            {showAllRows ? `Show first ${previewCount}` : 'Show all rows'}
          </button>
        ) : null}
      </div>
      <div className="rows-table-scroll">
        <table className="rows-table">
          <thead>
            <tr>
              {tableColumns.map((col) => (
                <th key={col} className="rows-table-heading" onClick={() => toggleSort(col)} title="Click to sort">
                  <span className="column-sort-label">
                    {col}
                    {sortMarker(col)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const rowKey = `${index}-${JSON.stringify(row)}`;
              return (
                <tr key={rowKey}>
                  {tableColumns.map((col) => (
                    <td key={`${rowKey}-${col}`}>{toCellText(row[col])}</td>
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
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="sql-panel">
      <div className="sql-panel-head">
        <p>Generated SQL</p>
        <button type="button" className="sql-copy" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy SQL'}
        </button>
      </div>
      <pre>{sql}</pre>
    </div>
  );
}

type ResultTabsProps = {
  activeSection: ResultSection;
  rowCount: number;
  hasSql: boolean;
  onSelect: (section: ResultSection) => void;
};

function ResultTabs({ activeSection, rowCount, hasSql, onSelect }: Readonly<ResultTabsProps>) {
  return (
    <div className="result-rail">
      <button
        type="button"
        className={`result-tab${activeSection === 'results' ? ' is-active' : ''}`}
        onClick={() => onSelect('results')}
      >
        Results ({rowCount})
      </button>
      <button
        type="button"
        className={`result-tab${activeSection === 'sql' ? ' is-active' : ''}`}
        onClick={() => onSelect('sql')}
        disabled={!hasSql}
      >
        SQL
      </button>
    </div>
  );
}

type ResultWorkspaceProps = {
  result: QueryResponse;
  activeSection: ResultSection;
  onSelectSection: (section: ResultSection) => void;
};

function ResultWorkspace({ result, activeSection, onSelectSection }: Readonly<ResultWorkspaceProps>) {
  const rows = result.rows ?? [];

  let sectionContent: ReactNode;
  if (activeSection === 'results') {
    sectionContent = (
      <>
        {result.ok ? <p className="answer-copy answer-copy-compact">{result.answer}</p> : <p className="error">{result.error}</p>}
        <div className="query-meta-stack">
          {result.generation_source ? (
            <p className="query-meta">
              Mode: <strong>{result.generation_source}</strong>
              {result.model_name ? ` (${result.model_name})` : ''}
            </p>
          ) : null}
          <p className="query-meta">
            Rows returned: <strong>{rows.length}</strong>
          </p>
        </div>
        <ResultTable rows={rows} />
      </>
    );
  } else if (result.sql) {
    sectionContent = <SqlPanel sql={result.sql} />;
  } else {
    sectionContent = <p>No SQL generated for this response.</p>;
  }

  return (
    <div className="result">
      <ResultTabs
        activeSection={activeSection}
        rowCount={rows.length}
        hasSql={Boolean(result.sql)}
        onSelect={onSelectSection}
      />
      <div className="result-panel">{sectionContent}</div>
    </div>
  );
}

function loadPinnedPrompts(): string[] {
  try {
    const raw = globalThis.localStorage.getItem(PINNED_PROMPTS_STORAGE_KEY);
    if (!raw) {
      return [EXAMPLES[0]];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [EXAMPLES[0]];
    }

    const prompts = parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    return prompts.length > 0 ? prompts : [EXAMPLES[0]];
  } catch {
    return [EXAMPLES[0]];
  }
}

export function ChatPanel({ onQueryResult }: Readonly<ChatPanelProps>) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [activeSection, setActiveSection] = useState<ResultSection>('results');
  const [pinnedQuestions, setPinnedQuestions] = useState<string[]>(loadPinnedPrompts);
  const [draggedPinnedPrompt, setDraggedPinnedPrompt] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const persistPinnedQuestions = (next: string[]) => {
    setPinnedQuestions(next);
    try {
      globalThis.localStorage.setItem(PINNED_PROMPTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  };

  const runPrompt = async (prompt: string) => {
    if (!prompt.trim()) {
      return;
    }

    setLoading(true);
    try {
      const response = await runQuestion(prompt.trim());
      setQuestion(prompt);
      setResult(response);
      setActiveSection('results');
      onQueryResult?.(prompt.trim(), response);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    await runPrompt(question);
  };

  const togglePinnedQuestion = (prompt: string) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      return;
    }

    const next = pinnedQuestions.includes(cleanPrompt)
      ? pinnedQuestions.filter((entry) => entry !== cleanPrompt)
      : [...pinnedQuestions, cleanPrompt];

    persistPinnedQuestions(next);
    setShowSuggestions(false);
  };

  const pinCurrentQuestion = () => {
    const cleanPrompt = question.trim();
    if (!cleanPrompt || pinnedQuestions.includes(cleanPrompt)) {
      return;
    }

    persistPinnedQuestions([...pinnedQuestions, cleanPrompt]);
  };

  const onQuestionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void runPrompt(question);
    }
  };

  const onSelectExample = (example: string) => {
    setQuestion(example);
    setShowSuggestions(false);
  };

  const clearAllPins = () => {
    persistPinnedQuestions([]);
  };

  const onPinnedDragStart = (prompt: string) => {
    setDraggedPinnedPrompt(prompt);
  };

  const onPinnedDrop = (targetPrompt: string) => {
    if (!draggedPinnedPrompt || draggedPinnedPrompt === targetPrompt) {
      setDraggedPinnedPrompt(null);
      return;
    }

    const fromIndex = pinnedQuestions.indexOf(draggedPinnedPrompt);
    const toIndex = pinnedQuestions.indexOf(targetPrompt);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggedPinnedPrompt(null);
      return;
    }

    const reordered = [...pinnedQuestions];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    persistPinnedQuestions(reordered);
    setDraggedPinnedPrompt(null);
  };

  const isCurrentQuestionPinned = pinnedQuestions.includes(question.trim());

  return (
    <section className="pane chat-pane">
      <h2>Conversational Query</h2>
      <p className="pane-intro">Ask a business question or start from one of the guided investigation prompts.</p>

      {pinnedQuestions.length > 0 ? (
        <div className="quick-run-bar">
          <div className="quick-run-head">
            <p className="quick-run-label">Pinned Quick Runs</p>
            <button type="button" className="quick-run-clear" onClick={clearAllPins}>
              Clear all
            </button>
          </div>
          <div className="quick-run-list">
            {pinnedQuestions.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className={`quick-run-chip${draggedPinnedPrompt === prompt ? ' is-dragging' : ''}`}
                draggable
                onDragStart={() => onPinnedDragStart(prompt)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => onPinnedDrop(prompt)}
                onDragEnd={() => setDraggedPinnedPrompt(null)}
                title="Drag to reorder"
                onClick={() => runPrompt(prompt)}
                disabled={loading}
              >
                <span className="quick-run-drag-dots" aria-hidden="true">••</span>
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="chat-form">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onQuestionKeyDown}
          placeholder="Ask a dataset question..."
          rows={4}
        />
        <div className="chat-actions">
          <button type="submit" disabled={loading}>
            {loading ? 'Running...' : 'Ask'}
          </button>
          <button
            type="button"
            className="chat-pin-current"
            onClick={pinCurrentQuestion}
            disabled={!question.trim() || isCurrentQuestionPinned}
            title="Pin current input to quick runs"
          >
            {isCurrentQuestionPinned ? 'Pinned' : 'Pin current'}
          </button>
        </div>
      </form>

      <div className="examples-collapsible">
        <button
          type="button"
          className="examples-toggle"
          onClick={() => setShowSuggestions((previous) => !previous)}
          aria-expanded={showSuggestions}
        >
          Suggested questions {showSuggestions ? '▲' : '▼'}
        </button>
        {showSuggestions ? (
          <div className="examples">
            {EXAMPLES.map((example) => {
              const isPinned = pinnedQuestions.includes(example);
              return (
                <div key={example} className="example-card">
                  <button type="button" className="example-chip" onClick={() => onSelectExample(example)}>
                    {example}
                  </button>
                  <button
                    type="button"
                    className={`example-pin${isPinned ? ' is-pinned' : ''}`}
                    onClick={() => togglePinnedQuestion(example)}
                    title={isPinned ? 'Unpin question' : 'Pin to quick runs'}
                  >
                    {isPinned ? 'Unpin' : 'Pin'}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {result ? <ResultWorkspace result={result} activeSection={activeSection} onSelectSection={setActiveSection} /> : null}
    </section>
  );
}
