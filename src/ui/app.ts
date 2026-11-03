/** État de l'application et navigation entre onglets. */
import { load, persist, blank, type Save } from "../data/store";
import { streak } from "../data/stats";
import { moduleById } from "../modules";
import type { RegionId } from "../data/regions";
import { runSession } from "./session";
import { renderToday } from "./today";
import { renderExercises } from "./exercises";
import { renderBrain } from "./brain";
import { renderStats } from "./stats";
import { renderJournal } from "./journal";

export type Tab = "today" | "exercises" | "brain" | "stats" | "journal";

export class App {
  save: Save = load();
  tab: Tab = "today";
  ritualPicks: string[] | null = null;
  filterRegion: RegionId | null = null;
  private view = document.getElementById("view")!;
  private tabs = document.getElementById("tabs")!;

  constructor() {
    this.tabs.querySelectorAll<HTMLButtonElement>("button[data-tab]").forEach((b) => b.addEventListener("click", () => this.show(b.dataset.tab as Tab)));
    const h = location.hash.replace("#", "") as Tab; if (["today", "exercises", "brain", "stats", "journal"].includes(h)) this.tab = h;
    this.refresh();
  }

  header() { document.getElementById("streak")!.textContent = `${streak(this.save)} j d'affilée`; }

  show(tab: Tab) { this.tab = tab; try { history.replaceState(null, "", "#" + tab); } catch { /* ignore */ } this.refresh(); }

  refresh() {
    this.header();
    this.tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.getAttribute("data-tab") === this.tab));
    const r = { today: renderToday, exercises: renderExercises, brain: renderBrain, stats: renderStats, journal: renderJournal }[this.tab];
    this.view.replaceChildren(r(this)); this.view.scrollTop = 0;
  }

  async play(id: string) {
    const m = moduleById(id); if (!m) return;
    await runSession(m, this.save);
    this.refresh();
  }

  reset() { this.save = blank(); persist(this.save); this.ritualPicks = null; this.refresh(); }
}
