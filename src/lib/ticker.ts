/**
 * Minuterie régulière exécutée dans un Web Worker : contrairement à
 * requestAnimationFrame, elle continue de tourner quand l'onglet est masqué
 * (indispensable quand on enregistre une autre fenêtre).
 *
 * Contre-pression : le worker n'envoie un nouveau battement que lorsque le
 * précédent a été traité, pour ne jamais saturer le fil principal sur une
 * machine lente (les images sont alors sautées au lieu de s'accumuler).
 */
const WORKER_SOURCE = `
let id = null;
let busy = false;
onmessage = (e) => {
  if (e.data === 'done') { busy = false; return; }
  clearInterval(id);
  if (e.data === 'stop') return;
  id = setInterval(() => {
    if (busy) return;
    busy = true;
    postMessage(0);
  }, e.data);
};
`;

export function createTicker(fps: number, onTick: () => void): () => void {
  const interval = Math.max(4, Math.round(1000 / fps));
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => {
      try {
        onTick();
      } finally {
        worker.postMessage('done');
      }
    };
    worker.postMessage(interval);
    return () => {
      worker.postMessage('stop');
      worker.terminate();
    };
  } catch {
    const id = window.setInterval(onTick, interval);
    return () => window.clearInterval(id);
  }
}
