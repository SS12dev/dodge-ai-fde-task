import axios from 'axios';
import type { GraphData, QueryResponse } from './types';

export type GraphMode = 'fast' | 'full';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  timeout: 30000,
});

export async function ingestData() {
  await api.post('/api/ingest/load', {});
}

export async function fetchGraph(mode: GraphMode = 'fast'): Promise<GraphData> {
  const { data } = await api.get('/api/graph', {
    params: {
      limit_per_table: 22,
      mode,
    },
  });
  return data;
}

export async function runQuestion(question: string): Promise<QueryResponse> {
  const { data } = await api.post('/api/chat/query', { question });
  return data;
}
