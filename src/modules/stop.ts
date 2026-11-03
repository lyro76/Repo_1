import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { roundRect, circle } from "../engine/draw";

export const stop: ModuleDef = {
  id: "stop", name: "Stop", regions: ["prefrontal"], duration: 60, scored: true,
  tagline: "Go / No-Go : touche les ronds, jamais les carrés.",
  hint: "Touche les ronds. Ne touche pas les carrés.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env; type Item = { go: boolean; x: number; y: number; life: number; hit: boolean };
    let item: Item | null = null, timer = 0.5, hits = 0, misses = 0, falses = 0, interval = 1.1;
    const spawn = () => { item = { go: Math.random() > 0.28, x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.6, life: interval * 0.7, hit: false }; };
    return {
      down() { if (!item || item.hit) return; item.hit = true; if (item.go) { hits++; interval = Math.max(0.5, interval * 0.97); env.audio.tick(); } else { falses++; interval = Math.min(1.4, interval + 0.15); env.audio.bad(); } },
      frame(dt) { const W = env.W, H = env.H; timer -= dt; if (item) { item.life -= dt; if (item.life <= 0) { if (item.go && !item.hit) misses++; item = null; timer = interval * 0.3 + Math.random() * 0.3; } } else if (timer <= 0) spawn();
        if (item) { const r = Math.min(W, H) * 0.1, x = item.x * W, y = item.y * H; ctx.fillStyle = item.hit ? css("--muted") : item.go ? css("--accent") : css("--accent-2"); if (item.go) { circle(ctx, x, y, r); ctx.fill(); } else { roundRect(ctx, x - r, y - r, 2 * r, 2 * r, 6); ctx.fill(); } } },
      status: () => `${hits} ok · ${misses} ratés · ${falses} fausses alertes`,
      result: () => ({ score: clamp100(((hits - 3 * falses - misses) / Math.max(1, hits + misses)) * 100), metric: falses, label: "fausses alertes" }),
    };
  },
};
