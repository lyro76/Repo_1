import { create } from 'zustand';
import type { ProjectSummary } from '@/types';

export type ProjectsStore = {
  items: ProjectSummary[];
  loading: boolean;
  error: string | null;
  setItems: (items: ProjectSummary[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
};

export const useProjectsStore = create<ProjectsStore>((set) => ({
  items: [],
  loading: false,
  error: null,
  setItems: (items) => set({ items }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
