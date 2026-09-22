import { Assets76 } from "./assets.mjs";
import { Protocol76, key, moves } from "./protocol76.mjs";
import { Writer, loginPacket, gamePacket, readLogin } from "./bytes.mjs";
import { Renderer76 } from "./renderer.mjs";
import { HunteraHUD } from "./hud.mjs";
import { MovementController, deltas, stepDuration } from "./movement.mjs";
const $ = (id) => document.getElementById(id),
  assets = new Assets76(),
  renderer = new Renderer76($("screen"), assets);
let protocol = null,
  socket = null,
  credentials = null,
  ready = false,
  useSource = null,
  tradeSource = null,
  dragSource = null,
  noticeTimer;
const hud = new HunteraHUD({
  assets,
  send,
  notice,
  getProtocol: () => (ready ? protocol : null),
  focusGame: () => $("screen").focus(),
});
const messages = [],
  errors = [];
const movement = new MovementController({
  position: () => protocol?.position,
  canStep: (direction, from) => {
    const [dx, dy] = deltas[direction];
    const tile = protocol.tiles.get(key({ x: from.x + dx, y: from.y + dy, z: from.z }));
    // Unknown/empty tiles may be a floor transition; let the server decide.
    return !tile?.things.some((thing) =>
      thing.kind === "creature" || assets.flag(thing.id, "DatFlagNotWalkable"));
  },
  send: (direction) => {
    if (!ready || socket?.readyState !== WebSocket.OPEN) return false;
    send(new Writer(moves[direction]));
    protocol.pendingMove = true;
    return true;
  },
});
let tradeOffers = {},
  suppressNextClick = false;
const dirs = {
  ArrowUp: "north",
  ArrowRight: "east",
  ArrowDown: "south",
  ArrowLeft: "west",
  Numpad8: "north",
  Numpad6: "east",
  Numpad2: "south",
  Numpad4: "west",
  Numpad7: "northwest",
  Numpad9: "northeast",
  Numpad3: "southeast",
  Numpad1: "southwest",
};
function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
function notice(text) {
  $("notice").textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ($("notice").textContent = ""), 4000);
}
function log(message) {
  const text =
    typeof message === "string"
      ? message
      : `${message.name ? message.name + ": " : ""}${message.text}`;
  messages.push(text);
  if (messages.length > 150) messages.shift();
  const div = document.createElement("div");
  div.className = `chat-message${typeof message === "string" || !message.name ? " message-system" : ""}`;
  const time = document.createElement("time");
  time.className = "message-time";
  time.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  div.append(time);
  if (typeof message !== "string" && message.name) {
    const author = document.createElement("span");
    author.className = "message-author";
    author.textContent = `${message.name}: `;
    div.append(author);
  }
  const body = document.createElement("span");
  body.className = "message-text";
  body.textContent = typeof message === "string" ? message : message.text;
  div.append(body);
  $("messages").append(div);
  if ($("messages").children.length > 150) $("messages").firstChild.remove();
  $("messages").scrollTop = $("messages").scrollHeight;
}
function send(packet) {
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(packet instanceof Writer ? packet.data : packet);
}
function wsUrl(path) {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
}
function fail(error) {
  const text = String(error.message || error);
  errors.push(text);
  status(text, true);
  notice(text);
  log(text);
  console.error(error);
  movement.reset();
  socket?.close();
}
function showLogin() {
  ready = false;
  document.body.classList.remove("in-game");
  hud.disconnect();
  movement.reset();
  useSource = null;
  $("welcome").hidden = false;
  $("game").hidden = true;
  $("logout").disabled = true;
  $("connection").textContent = "Offline";
  $("login").disabled = !assets.loaded;
}
async function cachedAssets(data) {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("yurots-760", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("files", data ? "readwrite" : "readonly"),
        store = tx.objectStore("files");
      if (data) store.put(data, "assets");
      const r = store.get("assets");
      let value;
      r.onsuccess = () => (value = r.result);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
$("assets").onchange = async (event) => {
  try {
    const files = Array.from(event.target.files),
      dat = files.find((f) => f.name.toLowerCase().endsWith(".dat")),
      spr = files.find((f) => f.name.toLowerCase().endsWith(".spr"));
    if (!dat || !spr) throw new Error("Select both .dat and .spr files.");
    const pair = await Promise.all([dat.arrayBuffer(), spr.arrayBuffer()]);
    await assets.load(...pair);
    await cachedAssets(pair);
    $("login").disabled = false;
    status("Tibia 7.6 assets ready.");
  } catch (error) {
    status(error.message || error, true);
  }
};
$("login-form").onsubmit = (event) => {
  event.preventDefault();
  const account = Number($("account").value);
  if (!Number.isInteger(account) || account < 1 || account > 0xffffffff) {
    status("Enter a valid numeric account.", true);
    return;
  }
  credentials = { account, password: $("password").value };
  $("login").disabled = true;
  $("characters").hidden = true;
  status("Connecting to YurOTS…");
  const login = new WebSocket(wsUrl("/login"));
  login.binaryType = "arraybuffer";
  let received = false;
  const timeout = setTimeout(() => {
    if (!received) {
      login.close();
      status("Login timed out. Check that YurOTS is running.", true);
      $("login").disabled = false;
    }
  }, 10000);
  login.onopen = () =>
    login.send(loginPacket(credentials.account, credentials.password));
  login.onmessage = (event) => {
    received = true;
    clearTimeout(timeout);
    login.close();
    $("login").disabled = false;
    try {
      const result = readLogin(event.data);
      $("character-list").replaceChildren();
      for (const c of result.characters) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "character";
        button.textContent = `${c.name} · ${c.world}`;
        button.onclick = () => connect(c.name);
        $("character-list").append(button);
      }
      $("characters").hidden = false;
      status(result.motd.replace(/^\d+\n/, ""));
    } catch (error) {
      status(error.message, true);
      credentials = null;
    }
  };
  login.onerror = () => {
    clearTimeout(timeout);
    status("Could not reach the login gateway.", true);
    $("login").disabled = false;
  };
  login.onclose = () => {
    clearTimeout(timeout);
    if (!received) {
      status("Login connection closed. Check that YurOTS is running.", true);
      $("login").disabled = false;
    }
  };
};
function connect(name) {
  if (!credentials) return;
  socket?.close();
  protocol = new Protocol76(assets, onEvent);
  tradeOffers = {};
  inventorySignature = "";
  containersSignature = "";
  battleSignature = "";
  renderer.effects = [];
  renderer.texts = [];
  renderer.missiles = [];
  errors.length = 0;
  messages.length = 0;
  $("messages").replaceChildren();
  movement.reset();
  const current = new WebSocket(wsUrl("/game"));
  socket = current;
  current.binaryType = "arraybuffer";
  status(`Entering as ${name}…`);
  $("characters").hidden = true;
  const auth = credentials;
  credentials = null;
  $("password").value = "";
  $("channel").replaceChildren(
    new Option("Say", "say"),
    new Option("Whisper", "whisper"),
    new Option("Yell", "yell"),
  );
  $("fight").value = "1";
  $("chase").checked = false;
  clearTimeout(noticeTimer);
  $("notice").textContent = "";
  current.onopen = () =>
    current.send(gamePacket(auth.account, auth.password, name));
  current.onmessage = (event) => {
    try {
      protocol.parse(event.data);
    } catch (error) {
      fail(error);
    }
  };
  current.onclose = () => {
    if (socket !== current) return;
    showLogin();
    if (!errors.length) status("Disconnected. Log in to return.");
  };
  current.onerror = () => {
    status("The game connection failed.", true);
  };
}
function onEvent(type, data) {
  switch (type) {
    case "send":
      send(data);
      break;
    case "error":
      errors.push(data);
      status(data, true);
      notice(data);
      socket?.close();
      break;
    case "map":
      confirmMovement();
      movement.clearPath();
      ready = true;
      document.body.classList.add("in-game");
      hud.startSession(protocol);
      $("welcome").hidden = true;
      $("game").hidden = false;
      renderer.resize();
      $("logout").disabled = false;
      $("connection").textContent = "Online";
      $("screen").focus();
      break;
    case "message":
      log(data);
      if (!data.name) notice(data.text);
      break;
    case "death":
      notice("You are dead. Log out and reconnect to return to the temple.");
      log("You are dead.");
      movement.stop();
      break;
    case "move":
      confirmMovement();
      break;
    case "cancelWalk":
      movement.reject();
      break;
    case "effect":
      renderer.effects.push(data);
      break;
    case "text":
      renderer.texts.push(data);
      break;
    case "missile":
      renderer.missiles.push(data);
      break;
    case "update":
      updateUI();
      break;
    case "outfit":
      outfitDialog(data);
      break;
    case "book":
      bookDialog(data);
      break;
    case "house":
      houseDialog(data);
      break;
    case "channels":
      channelDialog(data);
      break;
    case "channel": {
      let option = $("channel").querySelector(`[value="channel:${data.id}"]`);
      if (!option) {
        option = new Option(data.name, `channel:${data.id}`);
        $("channel").add(option);
      }
      $("channel").value = option.value;
      break;
    }
    case "channelClose":
      $("channel").querySelector(`[value="channel:${data}"]`)?.remove();
      break;
    case "trade":
      tradeDialog(data);
      break;
    case "tradeClose":
      tradeOffers = {};
      $("dialog").onclose = null;
      $("dialog").close();
      break;
  }
}
function itemRef(position, item, stack = 0) {
  return { position, item, stack };
}
function slot(item, ref, label = "") {
  const div = document.createElement("div");
  div.className = "slot";
  div.yurotsRef = ref;
  div.title = label;
  div.setAttribute("aria-label", label || `Item ${item?.id || "empty"}`);
  div.draggable = !!item;
  const icon = document.createElement("canvas");
  icon.width = 32;
  icon.height = 32;
  div.append(icon);
  if (item) {
    const ctx = icon.getContext("2d");
    assets.draw(ctx, item.id, 0, 0, { count: item.count, frame: 0 });
    if (item.count > 1 && assets.flag(item.id, "DatFlagStackable")) {
      const small = document.createElement("small");
      small.textContent = item.count;
      div.append(small);
    }
  }
  if (label) {
    const text = document.createElement("span");
    text.textContent = label;
    div.append(text);
  }
  div.ondblclick = () => ref?.item && use(ref);
  div.oncontextmenu = (e) => {
    e.preventDefault();
    if (ref?.item) context(e, ref);
  };
  div.onclick = (e) => {
    if (useSource && ref?.item) useWith(ref);
    else if (e.shiftKey && ref?.item) look(ref);
  };
  div.ondragstart = (e) => {
    dragSource = ref;
    e.dataTransfer.setData("text/plain", "yurots-item");
  };
  div.ondragover = (e) => e.preventDefault();
  div.ondrop = (e) => {
    e.preventDefault();
    if (dragSource && ref) moveItem(dragSource, ref.position);
    dragSource = null;
  };
  return div;
}
let inventorySignature = "",
  containersSignature = "",
  battleSignature = "";
function updateUI() {
  if (!protocol) return;
  hud.update(protocol);
  const s = protocol.stats;
  $("player-name").textContent = protocol.player?.name || "Character";
  if (protocol.position) {
    const p = protocol.position;
    $("coordinates").textContent = `${p.x}, ${p.y} · Floor ${p.z}`;
  }
  $("health").textContent = `${s.health ?? 0} / ${s.maxHealth ?? 0}`;
  $("mana").textContent = `${s.mana ?? 0} / ${s.maxMana ?? 0}`;
  $("health-fill").style.width =
    `${(100 * (s.health || 0)) / (s.maxHealth || 1)}%`;
  $("mana-fill").style.width = `${(100 * (s.mana || 0)) / (s.maxMana || 1)}%`;
  $("stats").replaceChildren(
    ...[
      `Level ${s.level || 0}`,
      `Magic ${s.magicLevel || 0}`,
      `Cap ${s.capacity || 0}`,
      `Soul ${s.soul || 0}`,
    ].map((t) => {
      const e = document.createElement("span");
      e.textContent = t;
      return e;
    }),
  );
  $("skills").textContent = protocol.skills
    .map(
      (s, i) =>
        `${["Fist", "Club", "Sword", "Axe", "Distance", "Shield", "Fishing"][i]} ${s.level} (${s.percent}%)`,
    )
    .join(" · ");
  const inv = JSON.stringify([...protocol.inventory]);
  if (inv !== inventorySignature) {
    inventorySignature = inv;
    $("inventory").replaceChildren();
    const names = [
      "",
      "Head",
      "Neck",
      "Backpack",
      "Armor",
      "Right hand",
      "Left hand",
      "Legs",
      "Feet",
      "Ring",
      "Ammo",
    ];
    for (let i = 1; i <= 10; i++) {
      const item = protocol.inventory.get(i);
      const cell = slot(
        item,
        itemRef({ x: 65535, y: i, z: 0 }, item),
        names[i],
      );
      cell.dataset.slot = i;
      $("inventory").append(cell);
    }
  }
  const containers = JSON.stringify([...protocol.containers]);
  if (containers !== containersSignature) {
    containersSignature = containers;
    $("containers").replaceChildren();
    for (const c of protocol.containers.values()) {
      const panel = document.createElement("section");
      panel.className = "container-panel";
      const header = document.createElement("div");
      header.className = "container-heading";
      const title = document.createElement("h2");
      title.textContent = c.name;
      header.append(title);
      if (c.parent) {
        const up = document.createElement("button");
        up.textContent = "↑";
        up.title = "Parent container";
        up.onclick = () => send(new Writer(0x88).u8(c.id));
        header.append(up);
      }
      const close = document.createElement("button");
      close.textContent = "×";
      close.title = "Close container";
      close.onclick = () => send(new Writer(0x87).u8(c.id));
      header.append(close);
      panel.append(header);
      const grid = document.createElement("div");
      grid.className = "container-items";
      for (let i = 0; i < c.capacity; i++)
        grid.append(
          slot(
            c.items[i],
            itemRef({ x: 65535, y: 64 + c.id, z: i }, c.items[i], i),
          ),
        );
      panel.append(grid);
      $("containers").append(panel);
    }
  }
  const creatures = visibleCreatures();
  const battleCount = $("battle-count");
  if (battleCount) battleCount.textContent = creatures.length;
  const battle = JSON.stringify(
    creatures.map((c) => [c.id, c.health, protocol.target]),
  );
  if (battle !== battleSignature) {
    battleSignature = battle;
    $("battle").replaceChildren();
    for (const c of creatures) {
      const button = document.createElement("button");
      button.setAttribute("aria-label", `${c.name} · ${c.health}%`);
      const avatar = document.createElement("canvas");
      avatar.width = 32;
      avatar.height = 32;
      avatar.className = "battle-avatar";
      if (c.outfit?.type)
        assets.draw(
          avatar.getContext("2d"),
          assets.data.itemCount + c.outfit.type,
          0,
          0,
          { outfit: c.outfit, direction: 2, frame: 0 },
        );
      const info = document.createElement("span");
      info.className = "battle-info";
      const name = document.createElement("span");
      name.className = "battle-name";
      name.textContent = c.name;
      const bar = document.createElement("span");
      bar.className = "battle-health";
      const fill = document.createElement("span");
      fill.style.width = `${c.health}%`;
      bar.append(fill);
      const hp = document.createElement("span");
      hp.className = "battle-meta";
      hp.textContent = `${c.health}%`;
      info.append(name, bar);
      button.append(avatar, info, hp);
      button.classList.toggle("target", c.id === protocol.target);
      button.onclick = () => {
        protocol.target = c.id;
        send(new Writer(0xa1).u32(c.id));
        updateUI();
      };
      $("battle").append(button);
    }
  }
  const emptyBag = $("container-empty");
  if (emptyBag) emptyBag.hidden = protocol.containers.size > 0;
  const capacityLabel = $("inventory-capacity");
  if (capacityLabel) capacityLabel.textContent = `${s.capacity || 0} oz`;
  $("vip").replaceChildren(
    ...Array.from(protocol.vip.values(), (friend) => {
      const e = document.createElement("div");
      e.textContent = `${friend.online ? "●" : "○"} ${friend.name}`;
      e.title = "Right click to remove friend";
      e.oncontextmenu = (event) => {
        event.preventDefault();
        send(new Writer(0xdd).u32(friend.id));
        protocol.vip.delete(friend.id);
        updateUI();
      };
      return e;
    }),
  );
}
function visibleCreatures() {
  if (!protocol?.position) return [];
  const ids = new Set();
  for (const t of protocol.tiles.values())
    if (
      t.position.z === protocol.position.z &&
      Math.abs(t.position.x - protocol.position.x) <= 8 &&
      Math.abs(t.position.y - protocol.position.y) <= 6
    )
      for (const c of t.things)
        if (c.kind === "creature" && c.id !== protocol.playerId) ids.add(c.id);
  return [...ids].map((id) => protocol.creatures.get(id)).filter(Boolean);
}
function topRef(position) {
  const tile = protocol?.tiles.get(key(position));
  if (!tile?.things.length) return null;
  let index = tile.things.length - 1;
  const creature = tile.things.findIndex((t) => t.kind === "creature");
  if (creature >= 0) index = creature;
  return itemRef(position, tile.things[index], index);
}
function eventPosition(e) {
  return renderer.worldPosition(e.clientX, e.clientY, protocol);
}

function look(ref) {
  send(
    new Writer(0x8c)
      .pos(ref.position)
      .u16(ref.item.kind === "creature" ? 99 : ref.item.id)
      .u8(ref.stack),
  );
}
function use(ref) {
  if (ref.item.kind === "creature") return;
  let id = 0;
  while (protocol.containers.has(id) && id < 15) id++;
  send(
    new Writer(0x82).pos(ref.position).u16(ref.item.id).u8(ref.stack).u8(id),
  );
}
function useWith(target) {
  const source = useSource;
  useSource = null;
  if (!source) return;
  send(
    new Writer(0x83)
      .pos(source.position)
      .u16(source.item.id)
      .u8(source.stack)
      .pos(target.position)
      .u16(target.item.kind === "creature" ? 99 : target.item.id)
      .u8(target.stack),
  );
}
function moveItem(source, to) {
  if (source.item.kind !== "item") return;
  send(
    new Writer(0x78)
      .pos(source.position)
      .u16(source.item.id)
      .u8(source.stack)
      .pos(to)
      .u8(source.item.count || 1),
  );
}
function context(event, ref) {
  const menu = $("context-menu");
  menu.replaceChildren();
  const add = (text, action) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.onclick = () => {
      menu.hidden = true;
      action();
    };
    menu.append(b);
  };
  add("Look", () => look(ref));
  if (ref.item.kind === "creature") {
    if (ref.item.id === protocol.playerId) {
      add("Leave party", () => send(new Writer(0xa7)));
    } else {
      add("Attack", () => {
        protocol.target = ref.item.id;
        send(new Writer(0xa1).u32(ref.item.id));
        updateUI();
      });
      if (ref.item.id >>> 28 === 1) {
        add("Invite to party", () => send(new Writer(0xa3).u32(ref.item.id)));
        add("Join party", () => send(new Writer(0xa4).u32(ref.item.id)));
        add("Revoke invitation", () => send(new Writer(0xa5).u32(ref.item.id)));
        add("Pass leadership", () => send(new Writer(0xa6).u32(ref.item.id)));
      }
    }
  } else {
    add("Use / open", () => use(ref));
    add("Trade with…", () => {
      tradeSource = ref;
      notice("Choose a player to trade with.");
    });
    add("Use with…", () => {
      useSource = ref;
      notice("Choose the target tile, creature, or item.");
    });
    if (assets.flag(ref.item.id, "DatFlagRotateable"))
      add("Rotate", () =>
        send(new Writer(0x85).pos(ref.position).u16(ref.item.id).u8(ref.stack)),
      );
  }
  menu.style.left = Math.min(event.clientX, innerWidth - 160) + "px";
  menu.style.top = Math.min(event.clientY, innerHeight - 190) + "px";
  menu.hidden = false;
}
document.addEventListener("click", (e) => {
  if (!$("context-menu").contains(e.target)) $("context-menu").hidden = true;
});
$("screen").oncontextmenu = (e) => {
  e.preventDefault();
  const p = eventPosition(e),
    ref = p && topRef(p);
  if (ref) context(e, ref);
};
$("screen").onclick = (e) => {
  const p = eventPosition(e),
    ref = p && topRef(p);
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  if (!p) return;
  if (tradeSource && ref?.item.kind === "creature") {
    const source = tradeSource;
    tradeSource = null;
    send(
      new Writer(0x7d)
        .pos(source.position)
        .u16(source.item.id)
        .u8(source.stack)
        .u32(ref.item.id),
    );
  } else if (useSource && ref) useWith(ref);
  else if (e.shiftKey && ref) look(ref);
  else movement.followPath(() => findPath(p));
  $("screen").focus();
};
$("screen").ondblclick = (e) => {
  const p = eventPosition(e),
    ref = p && topRef(p);
  if (ref) {
    movement.stop();
    use(ref);
  }
};
$("screen").ondragover = (e) => e.preventDefault();
$("screen").ondrop = (e) => {
  e.preventDefault();
  const p = eventPosition(e);
  if (p && dragSource) moveItem(dragSource, p);
  dragSource = null;
};
let groundDrag = null;
$("screen").onpointerdown = (e) => {
  if (e.button === 0) {
    const p = eventPosition(e);
    groundDrag = p ? topRef(p) : null;
  }
};
document.addEventListener("pointerup", (e) => {
  if (!groundDrag) return;
  const from = groundDrag;
  groundDrag = null;
  const target = e.target.closest(".slot");
  if (target?.yurotsRef) {
    moveItem(from, target.yurotsRef.position);
    return;
  }
  if (e.target === $("screen")) {
    const p = eventPosition(e);
    if (p && key(p) !== key(from.position) && from.item.kind === "item") {
      suppressNextClick = true;
      moveItem(from, p);
    }
  }
});
function walkable(p) {
  const t = protocol.tiles.get(key(p));
  return (
    t?.things.some(
      (t) => t.kind === "item" && assets.flag(t.id, "DatFlagGround"),
    ) &&
    !t.things.some(
      (t) => t.kind === "creature" || assets.flag(t.id, "DatFlagNotWalkable"),
    )
  );
}
function findPath(target) {
  if (!ready) return [];
  const from = protocol.position,
    queue = [from],
    seen = new Set([key(from)]),
    prev = new Map();
  for (let i = 0; i < queue.length && i < 600; i++) {
    const p = queue[i];
    if (key(p) === key(target)) {
      const result = [];
      let current = p;
      while (key(current) !== key(from)) {
        const step = prev.get(key(current));
        result.unshift(step.direction);
        current = step.from;
      }
      return result;
    }
    for (const [direction, [dx, dy]] of Object.entries(deltas)) {
      const to = { x: p.x + dx, y: p.y + dy, z: p.z };
      if (seen.has(key(to)) || !walkable(to)) continue;
      if (
        dx &&
        dy &&
        (!walkable({ ...p, x: p.x + dx }) || !walkable({ ...p, y: p.y + dy }))
      )
        continue;
      seen.add(key(to));
      prev.set(key(to), { from: p, direction });
      queue.push(to);
    }
  }
  notice("There is no way.");
  return [];
}
function confirmMovement() {
  const direction = movement.pending?.direction;
  if (!direction) return;
  const [dx, dy] = deltas[direction];
  const duration = stepDuration(assets, protocol.tiles.get(key(protocol.position)), protocol.player?.speed);
  movement.confirm(duration * (dx && dy ? 2 : 1));
}
function step() {
  if (ready) movement.tick();
}
document.addEventListener("keydown", (e) => {
  if (hud.isTyping(e.target)) return;
  if (e.key === "Enter" && ready) {
    if (e.target.closest("button, a")) return;
    e.preventDefault();
    const chatPanel = $("panel-chat");
    if (chatPanel.hidden) hud.setPanelVisible(chatPanel, true);
    $("chat-input").focus();
    return;
  }
  if (e.key === "Escape") {
    if (e.repeat) return;
    movement.stop(ready);
    useSource = null;
    tradeSource = null;
    protocol && (protocol.target = 0);
    if (ready) send(new Writer(0xbe));
    return;
  }
  if (e.key.toLowerCase() === "f") {
    e.preventDefault();
    $("fullscreen").click();
    return;
  }
  if (!ready || !dirs[e.code]) return;
  e.preventDefault();
  if (e.ctrlKey) {
    movement.stop();
    const d = ["north", "east", "south", "west"].indexOf(dirs[e.code]);
    if (d >= 0) send(new Writer(0x6f + d));
    return;
  }
  if (e.repeat) return;
  movement.press(e.code, dirs[e.code]);
  step();
});
document.addEventListener("keyup", (e) => movement.release(e.code));
window.addEventListener("blur", () => movement.stop());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) movement.stop();
});
document.addEventListener("focusin", (event) => {
  if (hud.isTyping(event.target)) movement.clearInput();
});
$("chat-form").onsubmit = (e) => {
  e.preventDefault();
  const text = $("chat-input").value.trim();
  if (!text) return;
  try {
    const mode = $("channel").value;
    let writer;
    if (text.startsWith("@")) {
      const end = text.indexOf("@", 1);
      if (end < 0) throw new Error("Private message: @Name@message");
      writer = new Writer(0x96)
        .u8(4)
        .string(text.slice(1, end))
        .string(text.slice(end + 1));
    } else {
      writer = new Writer(0x96).u8(
        mode.startsWith("channel:")
          ? 5
          : mode === "whisper"
            ? 2
            : mode === "yell"
              ? 3
              : 1,
      );
      if (mode.startsWith("channel:")) writer.u16(Number(mode.split(":")[1]));
      writer.string(text);
    }
    send(writer);
    $("chat-input").value = "";
    $("screen").focus();
  } catch (error) {
    notice(error.message);
  }
};
$("logout").onclick = () => {
  send(new Writer(0x14));
  movement.stop();
};
$("stop-attack").onclick = () => {
  protocol.target = 0;
  send(new Writer(0xa1).u32(0));
  updateUI();
};
$("fullscreen").onclick = () =>
  document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();
$("outfit").onclick = () => send(new Writer(0xd2));
$("channels").onclick = () => send(new Writer(0x97));
for (const id of ["fight", "chase"])
  $(id).onchange = () =>
    send(
      new Writer(0xa0)
        .u8(Number($("fight").value))
        .u8($("chase").checked ? 1 : 0),
    );
function dialog(title, build, accept, label = "Save") {
  const d = $("dialog");
  d.onclose = null;
  // Updating a live trade must not enqueue a close event that cancels it.
  $("dialog-title").textContent = title;
  $("dialog-body").replaceChildren();
  $("dialog-accept").hidden = !accept;
  $("dialog-accept").disabled = false;
  $("dialog-accept").textContent = label;
  build($("dialog-body"));
  d.onclose = () => {
    if (d.returnValue === "accept") accept?.();
  };
  d.returnValue = "";
  if (!d.open) d.showModal();
}
function field(parent, label, value, type = "number") {
  const l = document.createElement("label");
  l.textContent = label;
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  l.append(input);
  parent.append(l);
  return input;
}
function outfitDialog(data) {
  const values = {};
  dialog(
    "Choose your outfit",
    (body) => {
      for (const k of ["type", "head", "body", "legs", "feet"]) {
        values[k] = field(
          body,
          k === "type" ? "Outfit" : "Color: " + k,
          data.current[k],
        );
        values[k].min = k === "type" ? data.first : 0;
        values[k].max = k === "type" ? data.last : 132;
      }
    },
    () => {
      const w = new Writer(0xd3);
      for (const k of ["type", "head", "body", "legs", "feet"])
        w.u8(Number(values[k].value));
      send(w);
    },
  );
}
function bookDialog(book) {
  let input;
  dialog(
    "Read / write",
    (body) => {
      input = document.createElement("textarea");
      input.value = book.text;
      input.maxLength = book.maxLength;
      body.append(input);
    },
    () => send(new Writer(0x89).u32(book.id).string(input.value)),
  );
}
function houseDialog(house) {
  let input;
  dialog(
    "House access",
    (body) => {
      input = document.createElement("textarea");
      input.value = house.text;
      body.append(input);
    },
    () =>
      send(new Writer(0x8a).u8(house.type).u32(house.id).string(input.value)),
  );
}
function channelDialog(channels) {
  dialog(
    "Channels",
    (body) => {
      for (const c of channels) {
        const b = document.createElement("button");
        b.textContent = c.name;
        b.onclick = (e) => {
          e.preventDefault();
          send(new Writer(0x98).u16(c.id));
          $("dialog").close();
        };
        body.append(b);
      }
    },
    null,
  );
}
function tradeDialog(trade) {
  tradeOffers[trade.own ? "own" : "other"] = trade;
  dialog(
    "Trade",
    (body) => {
      for (const side of ["own", "other"]) {
        const offer = tradeOffers[side],
          title = document.createElement("h2");
        title.textContent =
          side === "own"
            ? "Your offer"
            : offer
              ? offer.name + " offers"
              : "Waiting for the other offer";
        body.append(title);
        const grid = document.createElement("div");
        grid.className = "container-items";
        for (const item of offer?.items || []) grid.append(slot(item, null));
        body.append(grid);
      }
    },
    () => send(new Writer(0x7f)),
    "Accept trade",
  );
  $("dialog-accept").disabled = !tradeOffers.own || !tradeOffers.other;
  $("dialog").onclose = () => {
    if ($("dialog").returnValue === "accept") send(new Writer(0x7f));
    else {
      send(new Writer(0x80));
      tradeOffers = {};
    }
  };
}
$("add-vip").onclick = () => {
  let input;
  dialog(
    "Add friend",
    (body) => (input = field(body, "Character name", "", "text")),
    () => send(new Writer(0xdc).string(input.value)),
    "Add friend",
  );
};
window.render_game_to_text = () =>
  JSON.stringify({
    mode: ready ? "playing" : "login",
    connected: socket?.readyState === 1,
    assets: assets.loaded,
    viewport: renderer.view,
    hud: hud.state(),
    coordinates: "x east, y south, z down; tiles use server coordinates",
    player: protocol?.player
      ? {
          id: protocol.playerId,
          name: protocol.player.name,
          position: protocol.position,
          direction: protocol.player.direction,
          ...protocol.stats,
        }
      : null,
    tiles: protocol?.tiles.size || 0,
    creatures: visibleCreatures().map((c) => ({
      id: c.id,
      name: c.name,
      health: c.health,
      position: c.position,
    })),
    inventory: protocol ? [...protocol.inventory] : [],
    containers: protocol ? [...protocol.containers.values()] : [],
    messages: messages.slice(-5),
    errors,
    packets: protocol?.packets || 0,
    movement: {
      pending: movement.pending?.direction || null,
      buffered: movement.buffered,
      held: [...movement.held.values()],
      pathLength: movement.path.length,
    },
  });
// This server is authoritative. Await real network time instead of simulating server state.
window.advanceTime = async (ms) => {
  await new Promise((r) => setTimeout(r, Math.max(0, Math.min(ms, 1000))));
  renderer.render(protocol);
};
window.yurots = {
  get protocol() {
    return protocol;
  },
  assets,
  renderer,
  hud,
  send,
  look,
  use,
  moveItem,
  findPath,
};
function loop() {
  if (hud.isTyping()) movement.clearInput();
  step();
  hud.tick();
  renderer.render(protocol);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
try {
  const pair = await cachedAssets().catch(() => null);
  await assets.load(...(pair || []));
  $("login").disabled = false;
  status("Tibia 7.6 assets ready.");
} catch (error) {
  status(error.message || error, true);
}
