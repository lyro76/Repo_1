import type { ModuleDef, ModuleInstance, ModuleEnv } from "./types";
import { clamp100 } from "./types";
import { roundRect } from "../engine/draw";

export const trame: ModuleDef = {
  id: "trame", name: "Trame", regions: ["prefrontal", "hippocampe"], duration: 90, scored: true,
  tagline: "Mémoire de travail : reproduis le motif.",
  hint: "Mémorise les cases allumées, puis touche-les.",
  create(env: ModuleEnv): ModuleInstance {
    const { ctx, css } = env;
    let size = 3, pattern = new Set<number>(), picked = new Set<number>(), phase: "show" | "play" | "win" | "fail" = "show", timer = 1.3, round = 1, wins = 0, maxSize = 3;
    const newPattern = () => { pattern = new Set(); const k = Math.min(size * size - 1, 2 + round); while (pattern.size < k) pattern.add(Math.floor(Math.random() * size * size)); picked = new Set(); phase = "show"; timer = 1.1 + size * 0.15; };
    newPattern();
    const geom = () => { const cell = (Math.min(env.W, env.H) * 0.84) / size; return { cell, ox: (env.W - cell * size) / 2, oy: (env.H - cell * size) / 2 }; };
    return {
      down(p) { if (phase !== "play") return; const { cell, ox, oy } = geom(); const c = Math.floor((p.x - ox) / cell), r = Math.floor((p.y - oy) / cell); if (c < 0 || r < 0 || c >= size || r >= size) return; const i = r * size + c;
        if (!pattern.has(i)) { phase = "fail"; timer = 1.2; env.audio.bad(); return; } picked.add(i); env.audio.tick(); if (picked.size === pattern.size) { phase = "win"; timer = 0.8; wins++; env.audio.good(); } },
      frame(dt) {
        timer -= dt;
        if (phase === "show" && timer <= 0) phase = "play";
        if (phase === "win" && timer <= 0) { round++; if (round % 3 === 0 && size < 6) size++; maxSize = Math.max(maxSize, size); newPattern(); }
        if (phase === "fail" && timer <= 0) { round = Math.max(1, round - 1); if (size > 3 && round % 3 === 0) size--; newPattern(); }
        const { cell, ox, oy } = geom(), pad = cell * 0.08;
        for (let i = 0; i < size * size; i++) { const c = i % size, r = Math.floor(i / size); const lit = (phase === "show" && pattern.has(i)) || picked.has(i) || (phase === "fail" && pattern.has(i));
          ctx.fillStyle = lit ? (phase === "fail" ? css("--accent-2") : css("--accent")) : css("--surface"); ctx.strokeStyle = css("--line"); ctx.lineWidth = 1;
          roundRect(ctx, ox + c * cell + pad, oy + r * cell + pad, cell - 2 * pad, cell - 2 * pad, cell * 0.12); ctx.fill(); ctx.stroke(); }
      },
      status: () => `${size}×${size} · tour ${round} · ${phase === "show" ? "regarde" : phase === "play" ? "reproduis" : phase === "fail" ? "raté" : "bravo"}`,
      result: () => ({ score: clamp100(wins * 8 + (maxSize - 3) * 10), metric: wins, label: "motifs réussis" }),
    };
  },
};
