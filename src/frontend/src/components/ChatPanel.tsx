import { useState } from 'react';
import type { FormEvent } from 'react';
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

  const onSubmit = async (event: FormEvent) => {
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
          {!result.ok ? <p className="error">{result.error}</p> : <p>{result.answer}</p>}
          {result.sql ? (
            <>
              <h3>Generated SQL</h3>
              <pre>{result.sql}</pre>
            </>
          ) : null}
          <h3>Rows</h3>
          <pre>{JSON.stringify(result.rows.slice(0, 20), null, 2)}</pre>
        </div>
      ) : null}
    </section>
  );
}
