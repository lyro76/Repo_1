import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MediaAsset, Project } from '@/types';

export type MediaRecord = MediaAsset & { blob: Blob };

interface ClipStudioDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: { updatedAt: number };
  };
  media: {
    key: string;
    value: MediaRecord;
    indexes: { projectId: string };
  };
}

const DB_NAME = 'clipstudio';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ClipStudioDB>> | null = null;

function db(): Promise<IDBPDatabase<ClipStudioDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ClipStudioDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const projects = database.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('updatedAt', 'updatedAt');
        const media = database.createObjectStore('media', { keyPath: 'id' });
        media.createIndex('projectId', 'projectId');
      },
    });
  }
  return dbPromise;
}

export async function listProjects(): Promise<Project[]> {
  const all = await (await db()).getAllFromIndex('projects', 'updatedAt');
  return all.reverse();
}

export async function getProject(id: string): Promise<Project | undefined> {
  return (await db()).get('projects', id);
}

export async function putProject(project: Project): Promise<void> {
  await (await db()).put('projects', project);
}

export async function deleteProject(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['projects', 'media'], 'readwrite');
  await tx.objectStore('projects').delete(id);
  const mediaStore = tx.objectStore('media');
  let cursor = await mediaStore.index('projectId').openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function putMedia(asset: MediaAsset, blob: Blob): Promise<void> {
  await (await db()).put('media', { ...asset, blob });
}

export async function getMedia(id: string): Promise<MediaRecord | undefined> {
  return (await db()).get('media', id);
}

export async function listProjectMedia(projectId: string): Promise<MediaRecord[]> {
  return (await db()).getAllFromIndex('media', 'projectId', projectId);
}

export async function deleteMedia(id: string): Promise<void> {
  await (await db()).delete('media', id);
}

export async function storageEstimate(): Promise<number | undefined> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return undefined;
  const estimate = await navigator.storage.estimate();
  return estimate.usage;
}
