import { Sfx } from "./engine/audio";
import { Screen } from "./engine/canvas";
import { Input } from "./engine/input";
import { startLoop } from "./engine/loop";
import { load, save as persist } from "./engine/storage";
import { COSTUMES } from "./char/skeleton";
import { Game } from "./game/game";
import { Renderer, THEMES } from "./game/render";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("c");
const screen = new Screen(canvas);
const renderer = new Renderer(screen.ctx, screen.w, screen.h);
const sfx = new Sfx();
const data = load();
sfx.muted = data.muted;
// Les gestes ne sont écoutés que sur le canvas : les menus (au-dessus) gardent leurs clics.
const input = new Input(canvas, (x, y) => screen.toUnits(x, y));

const game = new Game(Date.now() >>> 0, COSTUMES.find((c) => c.id === data.costume) ?? COSTUMES[0], sfx, {
  onDeath(score, coins) {
    data.coins += coins;
    data.runs++;
    const record = score > data.best;
    if (record) data.best = score;
    persist(data);
    $("o-score").textContent = `${score} m`;
    $("o-coins").textContent = `◉ ${coins}`;
    $("o-best").textContent = record ? "Nouveau record !" : `record ${data.best} m`;
    $("hud").hidden = true;
    $("over").hidden = false;
    refreshMenu();
  },
  onCoin(total) {
    $("coins").textContent = `◉ ${total}`;
  },
});

let theme = THEMES[0];
// Pour les tests automatisés et le débogage.
(window as any).__cavale = { game, data };

function refreshMenu() {
  $("m-best").textContent = `record ${data.best} m`;
  $("m-coins").textContent = `◉ ${data.coins}`;
  $("mute").textContent = `Son : ${sfx.muted ? "non" : "oui"}`;
}

function startRun() {
  sfx.unlock();
  theme = THEMES[data.runs % THEMES.length];
  game.start((Date.now() ^ (data.runs * 7919)) >>> 0);
  $("menu").hidden = true;
  $("over").hidden = true;
  $("paused").hidden = true;
  $("hud").hidden = false;
  $("coins").textContent = "◉ 0";
}

$("play").onclick = startRun;
$("retry").onclick = startRun;
$("to-menu").onclick = () => {
  $("over").hidden = true;
  $("menu").hidden = false;
};
$("pause").onclick = () => {
  if (game.phase !== "running") return;
  game.phase = "paused";
  $("paused").hidden = false;
};
$("resume").onclick = () => {
  game.phase = "running";
  $("paused").hidden = true;
  input.drain();
};
$("quit").onclick = () => {
  game.phase = "menu";
  game.player.ch.state = "idle";
  $("paused").hidden = true;
  $("hud").hidden = true;
  $("menu").hidden = false;
};
$("mute").onclick = () => {
  sfx.muted = !sfx.muted;
  data.muted = sfx.muted;
  persist(data);
  refreshMenu();
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.phase === "running") $("pause").click();
});

// ---- costumes
function renderShop() {
  const list = $("shop-list");
  list.replaceChildren(
    ...COSTUMES.map((c) => {
      const owned = data.unlocked.includes(c.id);
      const b = document.createElement("button");
      b.className = `${owned ? "owned" : ""} ${data.costume === c.id ? "current" : ""}`;
      const sw = document.createElement("span");
      sw.className = "sw";
      sw.style.background = `linear-gradient(135deg, ${c.cloth} 50%, ${c.cape ?? c.cloth2} 50%)`;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = c.name;
      const price = document.createElement("span");
      price.className = "price mono";
      price.textContent = owned ? (data.costume === c.id ? "porté" : "possédé") : `◉ ${c.price}`;
      b.append(sw, name, price);
      b.onclick = () => {
        if (!owned) {
          if (data.coins < c.price) return;
          data.coins -= c.price;
          data.unlocked.push(c.id);
          sfx.fanfare();
        }
        data.costume = c.id;
        persist(data);
        game.setCostume(c.id);
        refreshMenu();
        renderShop();
      };
      return b;
    }),
  );
}
$("shop").onclick = () => {
  sfx.unlock();
  renderShop();
  $("menu").hidden = true;
  $("shop-view").hidden = false;
};
$("shop-close").onclick = () => {
  $("shop-view").hidden = true;
  $("menu").hidden = false;
};

// ---- boucle
refreshMenu();
let lastShown = -1;
startLoop(
  (dt) => {
    for (const g of input.drain()) game.gesture(g);
    game.update(dt);
    if (game.phase === "running" && game.score !== lastShown) {
      lastShown = game.score;
      $("score").textContent = `${game.score}`;
    }
  },
  () => {
    if (renderer.w !== screen.w || renderer.h !== screen.h) renderer.resize(screen.w, screen.h);
    screen.begin();
    renderer.draw(game.world, game.player, theme, game.time, game.shake);
  },
);
