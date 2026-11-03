/** Boucle à pas fixe (simulation) et rendu à chaque image. */
export function startLoop(update: (dt: number) => void, render: (alpha: number) => void, step = 1 / 120) {
  let last = performance.now();
  let acc = 0;
  let running = true;
  const frame = (now: number) => {
    if (!running) return;
    // Un onglet caché revient avec un gros écart : on le borne.
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    let n = 0;
    // Une erreur dans une image ne doit pas figer le jeu : on la signale et on continue.
    try {
      while (acc >= step && n < 30) {
        update(step);
        acc -= step;
        n++;
      }
      render(acc / step);
    } catch (e) {
      console.error(e);
      acc = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return () => {
    running = false;
  };
}
