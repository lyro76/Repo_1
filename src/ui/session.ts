/** Lance un module en plein écran : chrono, statut, résultat, sauvegarde. */
import { Stage } from "../engine/stage";
import { Audio } from "../engine/audio";
import { cssVar } from "../engine/draw";
import type { ModuleDef, ModuleInstance, ModuleResult } from "../modules";
import { addSession, persist, type Save } from "../data/store";
import { bestOf } from "../data/stats";

export interface SessionOutcome { result: ModuleResult; duration: number; aborted: boolean }

const audio = new Audio();
const $ = (id: string) => document.getElementById(id)!;

export function runSession(mod: ModuleDef, save: Save): Promise<SessionOutcome> {
  return new Promise((resolve) => {
    const root = $("session"), box = $("s-box"), canvas = $("s-canvas") as HTMLCanvasElement, resultEl = $("s-result");
    root.hidden = false; resultEl.hidden = true; $("s-title").textContent = mod.name; $("s-hint").textContent = mod.hint; $("s-status").textContent = "";
    audio.muted = save.settings.muted;
    const stage = new Stage(canvas, box);
    const env = { ...stage.env, audio, css: cssVar, breath: save.settings.breath };
    // W/H doivent rester vivants : on relit depuis stage.env à chaque frame
    Object.defineProperty(env, "W", { get: () => stage.env.W }); Object.defineProperty(env, "H", { get: () => stage.env.H });
    let inst: ModuleInstance; try { inst = mod.create(env); } catch (e) { console.error(e); root.hidden = true; resolve({ result: { score: 0, metric: 0, label: "" }, duration: 0, aborted: true }); return; }
    let elapsed = 0, ended = false, started = false;
    const finish = (aborted: boolean) => {
      if (ended) return; ended = true; stage.stop();
      const result = inst.result(); const duration = Math.round(elapsed);
      if (!aborted && mod.scored && duration >= 10) { const prev = bestOf(save, mod.id); addSession(save, { m: mod.id, t: Date.now(), s: result.score, v: result.metric, d: duration }); persist(save);
        resultEl.innerHTML = `<div class="eyebrow">${mod.name}</div><b>${result.score}</b><div class="sub">indice sur 100${prev ? ` · record ${Math.max(prev.s, result.score)}` : " · première séance"}</div><div>${result.metric} ${result.label}</div><button class="btn" id="s-ok">Continuer</button>`;
        resultEl.hidden = true; resultEl.hidden = false; audio.good();
        $("s-ok").onclick = () => { root.hidden = true; resolve({ result, duration, aborted: false }); };
      } else { root.hidden = true; resolve({ result, duration, aborted: true }); }
    };
    $("s-quit").onclick = () => finish(true);
    stage.handlers = {
      frame(dt, now) {
        if (!started) { audio.unlock(); started = true; }
        elapsed += dt; const left = Math.max(0, mod.duration - elapsed);
        $("s-time").textContent = `${Math.floor(left / 60)}:${String(Math.ceil(left % 60) % 60).padStart(2, "0")}`;
        $("s-progress").style.width = `${Math.min(100, (100 * elapsed) / mod.duration)}%`;
        inst.frame(dt, now); $("s-status").textContent = inst.status();
        if (left <= 0 || inst.finished?.()) finish(false);
      },
      down: (p) => { audio.unlock(); inst.down?.(p); }, drag: (p) => inst.drag?.(p), up: (p) => inst.up?.(p),
    };
    stage.start();
  });
}
