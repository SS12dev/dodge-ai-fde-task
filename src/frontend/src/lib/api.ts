import axios from 'axios';
import type { GraphData, QueryResponse } from './types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  timeout: 30000,
});

export async function ingestData() {
  await api.post('/api/ingest/load', {});
}

export async function fetchGraph(): Promise<GraphData> {
  const { data } = await api.get('/api/graph');
  return data;
}

export async function runQuestion(question: string): Promise<QueryResponse> {
  const { data } = await api.post('/api/chat/query', { question });
  return data;
}
