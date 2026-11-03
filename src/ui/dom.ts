/** Mini-aide DOM : création d'éléments par HTML, échappement. */
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export function html(str: string): HTMLElement { const t = document.createElement("template"); t.innerHTML = str.trim(); return t.content.firstElementChild as HTMLElement; }
export const fmtDay = (day: string) => { const d = new Date(day + "T00:00:00"); return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }); };
