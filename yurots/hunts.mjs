import { Writer } from "./bytes.mjs";
const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("en-US");
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class HuntUI {
  constructor({ assets, send, getProtocol, stopInput, notice, focusGame }) {
    Object.assign(this, {
      assets,
      send,
      getProtocol,
      stopInput,
      notice,
      focusGame,
    });
    this.catalog = [];
    this.total = 0;
    this.selected = null;
    this.detail = null;
    this.current = { active: false };
    this.mode = 0;
    this.autoLoot = true;
    this.loading = false;
    this.filterFavorites = false;
    try {
      this.favorites = new Set(
        JSON.parse(localStorage.getItem("yurots.hunts.favorites.v1") || "[]"),
      );
    } catch {
      this.favorites = new Set();
    }
    const button = el("button", "icon-button hunt-nav");
    button.id = "hunts";
    button.type = "button";
    button.disabled = true;
    button.title = "Organize hunt";
    button.setAttribute("aria-label", "Organize hunt");
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 18M19 3L5 21M3 7l4-3M17 4l4 3M3 17l4 4M17 21l4-4"/></svg><span class="button-caption">Hunts</span>';
    document.querySelector(".game-nav").prepend(button);
    button.onclick = () => this.open();
    this.dialog = el("dialog", "hunt-dialog");
    this.dialog.id = "hunt-dialog";
    this.dialog.setAttribute("aria-labelledby", "hunt-title");
    this.dialog.innerHTML = `<div class="hunt-heading"><h2 id="hunt-title">Organize hunt</h2><button type="button" id="hunt-close" aria-label="Close hunt catalog">×</button></div>
      <nav class="hunt-tabs"><button type="button" id="hunt-all" class="selected">HUNTS</button><button type="button" id="hunt-favorites">★ FAVORITES</button></nav>
      <div id="hunt-alert" role="status"></div><div id="hunt-catalog-view"><div class="hunt-search-row"><input id="hunt-search" type="search" placeholder="Search hunts or creatures…" aria-label="Search hunts"><span id="hunt-count"></span></div><div id="hunt-grid" class="hunt-grid"></div></div>
      <div id="hunt-detail-view" hidden></div><footer class="hunt-footer"><button type="button" id="hunt-back" hidden>‹ Back to catalog</button><span id="hunt-explanation">A private instance for you and your party.</span><button type="button" id="hunt-start" class="primary" hidden>Start hunt</button></footer>`;
    document.body.append(this.dialog);
    $("hunt-close").onclick = () => this.dialog.close();
    this.dialog.addEventListener("close", () => this.focusGame());
    $("hunt-search").oninput = () => this.renderCatalog();
    $("hunt-back").onclick = () => this.showCatalog();
    $("hunt-all").onclick = () => {
      this.filterFavorites = false;
      this.showCatalog();
    };
    $("hunt-favorites").onclick = () => {
      this.filterFavorites = true;
      this.showCatalog();
    };
    $("hunt-start").onclick = () => this.start();
    const controls = el("section", "hunt-controls");
    controls.id = "hunt-controls";
    controls.hidden = true;
    controls.setAttribute("aria-label", "Active hunt");
    controls.innerHTML =
      '<div class="hunt-live-info"><strong id="hunt-live-name"></strong><span id="hunt-activity"></span><small id="hunt-live-stats"></small></div><button id="hunt-pause">Pause auto-hunt</button><button id="hunt-leave">Leave hunt</button>';
    document.querySelector(".hud-overlay").append(controls);
    $("hunt-pause").onclick = () => {
      this.stopInput();
      this.send(new Writer(0xf0).u8(this.current.automatic ? 2 : 3));
    };
    $("hunt-leave").onclick = () => {
      this.stopInput();
      this.send(new Writer(0xf0).u8(4));
    };
    this.dialog.addEventListener("keydown", (event) => event.stopPropagation());
  }
  connected() {
    $("hunts").disabled = false;
  }
  open() {
    if (!this.getProtocol()?.position) {
      this.notice("Log in to choose a hunt.");
      return;
    }
    this.stopInput();
    this.alert("");
    this.showCatalog();
    if (!this.dialog.open) this.dialog.showModal();
    this.send(new Writer(0xf0).u8(5));
    if (!this.catalog.length && !this.loading) {
      this.loading = true;
      this.send(new Writer(0xf0).u8(0).u16(0));
    }
  }
  reset() {
    $("hunts").disabled = true;
    this.current = { active: false };
    this.loading = false;
    this.catalog = [];
    this.total = 0;
    this.selected = null;
    this.detail = null;
    $("hunt-controls").hidden = true;
    if (this.dialog.open) this.dialog.close();
  }
  alert(message, error = false) {
    $("hunt-alert").textContent = message;
    $("hunt-alert").classList.toggle("error", error);
  }
  handle(message) {
    if (message.event === "catalog") {
      if (message.offset === 0) this.catalog = [];
      const existing = new Map(this.catalog.map((h) => [h.id, h]));
      for (const h of message.hunts) existing.set(h.id, h);
      this.catalog = [...existing.values()];
      this.total = message.total;
      if (message.next < this.total)
        this.send(new Writer(0xf0).u8(0).u16(message.next));
      else this.loading = false;
      this.renderCatalog();
      return;
    }
    if (message.event === "detail") {
      if (this.selected === message.hunt.id) {
        this.detail = message.hunt;
        this.renderDetail();
      }
      return;
    }
    if (message.event === "error") {
      this.loading = false;
      this.alert(message.message, true);
      this.notice(message.message);
      $("hunt-start").disabled = false;
      return;
    }
    if (message.event === "state") {
      const starting =
        message.active &&
        (!this.current.active || message.instance !== this.current.instance);
      this.current = message;
      const protocol = this.getProtocol();
      if (protocol) protocol.target = message.active ? message.target : 0;
      $("hunt-controls").hidden = !message.active;
      if (message.active) {
        if (starting) {
          this.stopInput();
          if (this.dialog.open) this.dialog.close();
        }
        $("hunt-live-name").textContent = message.name;
        $("hunt-activity").textContent = message.activity;
        $("hunt-live-stats").textContent =
          `${number.format(message.kills)} kills · ${number.format(message.experience)} XP · ${number.format(message.items)} items · ${message.members === 1 ? "Solo" : message.members + " party members"}${message.alive === 0 && message.respawnIn ? " · Respawn " + message.respawnIn + "s" : ""}`;
        $("hunt-pause").textContent = message.automatic
          ? "Pause auto-hunt"
          : "Resume auto-hunt";
      } else if (message.message) {
        this.notice(message.message);
        this.alert(message.message);
      }
      if (this.detail && this.dialog.open) this.renderDetail();
    }
  }
  icon(monster, size = 56) {
    const canvas = el("canvas", "hunt-monster");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const id = this.assets.data.itemCount + monster.look,
      object = this.assets.get(id);
    if (object) {
      const frame = object.frameGroups[0],
        scale = Math.min(1.75, 56 / (Math.max(frame.width, frame.height) * 32));
      const displacement = object.properties.displacement || { x: 0, y: 0 };
      const x =
        (64 - frame.width * 32 * scale) / 2 +
        (frame.width - 1) * 32 * scale +
        displacement.x * scale;
      const y =
        (64 - frame.height * 32 * scale) / 2 +
        (frame.height - 1) * 32 * scale +
        displacement.y * scale;
      ctx.save();
      ctx.scale(scale, scale);
      this.assets.draw(ctx, id, x / scale, y / scale, {
        outfit: { type: monster.look, head: 0, body: 0, legs: 0, feet: 0 },
        direction: 2,
        frame: 0,
      });
      ctx.restore();
    }
    canvas.style.width = canvas.style.height = size + "px";
    return canvas;
  }
  favorite(id, event) {
    event?.stopPropagation();
    this.favorites.has(id) ? this.favorites.delete(id) : this.favorites.add(id);
    try {
      localStorage.setItem(
        "yurots.hunts.favorites.v1",
        JSON.stringify([...this.favorites]),
      );
    } catch {}
    this.renderCatalog();
  }
  showCatalog() {
    this.selected = null;
    this.detail = null;
    $("hunt-title").textContent = "Organize hunt";
    $("hunt-catalog-view").hidden = false;
    $("hunt-detail-view").hidden = true;
    $("hunt-back").hidden = true;
    $("hunt-start").hidden = true;
    $("hunt-all").classList.toggle("selected", !this.filterFavorites);
    $("hunt-favorites").classList.toggle("selected", this.filterFavorites);
    this.renderCatalog();
  }
  renderCatalog() {
    if (this.selected) return;
    const query = $("hunt-search").value.trim().toLowerCase();
    const hunts = this.catalog.filter(
      (h) =>
        (!this.filterFavorites || this.favorites.has(h.id)) &&
        `${h.name} ${h.monsters.map((m) => m.name).join(" ")}`
          .toLowerCase()
          .includes(query),
    );
    $("hunt-count").textContent = this.loading
      ? `Loading ${this.catalog.length} / ${this.total || "…"} hunts`
      : `${hunts.length} hunts available`;
    const grid = $("hunt-grid");
    grid.replaceChildren();
    for (const h of hunts) {
      const card = el("article", "hunt-card");
      card.dataset.huntId = h.id;
      const main = el("button", "hunt-card-main");
      main.type = "button";
      main.setAttribute(
        "aria-label",
        `${h.name}, sector ${h.center.x},${h.center.y}, floor ${h.center.z}`,
      );
      main.append(this.icon(h.monsters[0]));
      const text = el("div", "hunt-card-text");
      text.append(
        el("h3", "", h.name),
        el("p", "", h.monsters.map((m) => m.name).join(", ")),
      );
      main.append(text);
      main.onclick = () => {
        this.selected = h.id;
        this.detail = null;
        $("hunt-title").textContent = h.name;
        this.alert("Loading hunt details…");
        this.send(new Writer(0xf0).u8(6).u16(h.id));
      };
      const star = el(
        "button",
        "hunt-favorite",
        this.favorites.has(h.id) ? "★" : "☆",
      );
      star.type = "button";
      star.setAttribute("aria-label", `Favorite ${h.name}`);
      star.onclick = (e) => this.favorite(h.id, e);
      const footer = el("div", "hunt-card-footer");
      footer.append(
        el("span", "", `${h.spawns} spawn${h.spawns === 1 ? "" : "s"}`),
        el("span", "", `${h.center.x}, ${h.center.y} · Floor ${h.center.z}`),
      );
      card.append(main, star, footer);
      grid.append(card);
    }
    if (!hunts.length)
      grid.append(
        el(
          "p",
          "hunt-empty",
          this.loading
            ? "Loading hunting areas…"
            : "No hunts match your search.",
        ),
      );
  }
  renderDetail() {
    const h = this.detail;
    if (!h) return;
    this.alert("");
    $("hunt-catalog-view").hidden = true;
    $("hunt-detail-view").hidden = false;
    $("hunt-back").hidden = false;
    $("hunt-start").hidden = false;
    $("hunt-title").textContent = h.name;
    const root = $("hunt-detail-view");
    root.replaceChildren();
    const hero = el("div", "hunt-hero");
    hero.append(this.icon(h.monsters[0], 80));
    const info = el("div");
    info.append(
      el("h2", "", h.name),
      el(
        "p",
        "",
        `Explore a private copy of sector ${h.center.x}, ${h.center.y}, floor ${h.center.z}.`,
      ),
    );
    hero.append(info);
    root.append(hero);
    const columns = el("div", "hunt-detail-columns"),
      left = el("section", "hunt-box"),
      right = el("section", "hunt-box");
    left.append(el("h3", "", "Pull size"));
    const modes = el("div", "hunt-modes");
    ["Cautious", "Daring", "Aggressive"].forEach((label, index) => {
      const button = el("button", index === this.mode ? "selected" : "", label);
      button.type = "button";
      button.dataset.pull = index;
      button.onclick = () => {
        this.mode = index;
        this.renderDetail();
      };
      modes.append(button);
    });
    left.append(
      modes,
      el(
        "p",
        "",
        `Up to ${[1, 3, 5][this.mode]} active monster${this.mode ? "s" : ""}. Respawns follow the area's original timers.`,
      ),
      el("h3", "", "Creatures in this hunt"),
    );
    const monsters = el("div", "hunt-creatures");
    for (const m of h.monsters) {
      const row = el("div", "hunt-creature");
      row.append(this.icon(m, 48));
      const label = el("div");
      label.append(
        el("strong", "", m.name),
        el(
          "small",
          "",
          `${m.count} spawn${m.count === 1 ? "" : "s"} · ${number.format(m.health)} HP · ${number.format(m.experience)} base XP`,
        ),
      );
      row.append(label);
      monsters.append(row);
    }
    left.append(monsters);
    right.append(el("h3", "", "Possible loot"));
    const collect = el("label", "hunt-loot-toggle");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.id = "hunt-autoloot";
    checkbox.checked = this.autoLoot;
    checkbox.onchange = () => (this.autoLoot = checkbox.checked);
    collect.append(
      checkbox,
      document.createTextNode(" Collect loot automatically when there is room"),
    );
    right.append(collect);
    const loot = el("div", "hunt-loot");
    for (const item of h.loot) {
      const row = el("div", "hunt-loot-row"),
        canvas = el("canvas");
      canvas.width = canvas.height = 32;
      this.assets.draw(canvas.getContext("2d"), item.id, 0, 0, {
        count: item.count || 1,
        frame: 0,
      });
      row.append(
        canvas,
        el("span", "", item.name || `Item ${item.id}`),
        el(
          "small",
          "",
          `Up to ${Math.min(100, item.chance).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`,
        ),
      );
      loot.append(row);
    }
    if (!h.loot.length)
      loot.append(el("p", "", "No items in this creature loot table."));
    right.append(loot);
    columns.append(left, right);
    root.append(columns);
    $("hunt-start").disabled = !!this.current.active;
    $("hunt-start").textContent = this.current.active
      ? "Already in a hunt"
      : "Start private hunt";
    $("hunt-explanation").textContent = this.current.active
      ? "Leave your current hunt before starting another."
      : "Party members selecting this hunt join the same private instance.";
  }
  start() {
    if (!this.detail || this.current.active) return;
    this.stopInput();
    $("hunt-start").disabled = true;
    this.alert("Preparing your private hunt…");
    this.send(
      new Writer(0xf0)
        .u8(1)
        .u16(this.detail.id)
        .u8(this.mode)
        .u8(this.autoLoot ? 1 : 0),
    );
  }
  state() {
    return {
      ...this.current,
      catalogCount: this.catalog.length,
      catalogTotal: this.total,
      selected: this.selected,
    };
  }
}
