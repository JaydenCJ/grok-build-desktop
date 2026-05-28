import { invoke } from '@tauri-apps/api/core';

export interface Prompt {
  id: string;
  name: string;
  category: string | null;
  body: string;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  updated_at?: number;
}

interface RawPrompt {
  id: string;
  name: string;
  category: string | null;
  body: string;
  created_at: number;
  updated_at: number;
}

function normalize(p: RawPrompt): Prompt {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    body: p.body,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export async function listPrompts(): Promise<Prompt[]> {
  const raw = await invoke<RawPrompt[]>('list_prompts');
  return raw.map(normalize);
}

export async function upsertPrompt(input: {
  id?: string;
  name: string;
  body: string;
  category?: string | null;
}): Promise<Prompt> {
  const raw = await invoke<RawPrompt>('upsert_prompt', {
    id: input.id ?? null,
    name: input.name,
    body: input.body,
    category: input.category ?? null,
  });
  return normalize(raw);
}

export async function deletePrompt(id: string): Promise<boolean> {
  return invoke<boolean>('delete_prompt', { id });
}
