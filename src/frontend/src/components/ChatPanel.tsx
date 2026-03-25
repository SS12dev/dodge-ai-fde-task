import { useState } from 'react';
import { runQuestion } from '../lib/api';
import type { QueryResponse } from '../lib/types';

const EXAMPLES = [
  'Which products are associated with the highest number of billing documents?',
  'Trace the full flow for billing document 10001234',
  'Identify sales orders that are delivered but not billed',
];

export function ChatPanel() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);

  const onSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!question.trim()) {
      return;
    }
    setLoading(true);
    try {
      const response = await runQuestion(question.trim());
      setResult(response);
    } finally {
      setLoading(false);
    }
  };

  const rows = result?.rows ?? [];
  const tableColumns = rows.length > 0 ? Object.keys(rows[0]) : [];

  const toCellText = (value: unknown): string => {
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
  };

  return (
    <section className="pane chat-pane">
      <h2>Conversational Query</h2>
      <form onSubmit={onSubmit} className="chat-form">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a dataset question..."
          rows={4}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Running...' : 'Ask'}
        </button>
      </form>
      <div className="examples">
        {EXAMPLES.map((example) => (
          <button key={example} onClick={() => setQuestion(example)}>
            {example}
          </button>
        ))}
      </div>
      {result ? (
        <div className="result">
          {result.ok ? <p>{result.answer}</p> : <p className="error">{result.error}</p>}
          {result.generation_source ? (
            <p className="query-meta">
              Mode: <strong>{result.generation_source}</strong>
              {result.model_name ? ` (${result.model_name})` : ''}
            </p>
          ) : null}
          {result.sql ? (
            <>
              <h3>Generated SQL</h3>
              <pre>{result.sql}</pre>
            </>
          ) : null}
          <h3>Rows</h3>
          {rows.length === 0 ? (
            <p>No rows returned.</p>
          ) : (
            <div className="rows-table-wrap">
              <table className="rows-table">
                <thead>
                  <tr>
                    {tableColumns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((row) => {
                    const rowKey = JSON.stringify(row);
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
              {rows.length > 20 ? <p>Showing first 20 rows of {rows.length}.</p> : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
