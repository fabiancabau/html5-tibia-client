# YurOTS / Tibia 7.6 mode

This fork adds a native 7.6 browser mode at `/yurots.html` (the default page when using the bundled gateway). The original Forby client remains at `/index.html`.

```sh
npm ci
# Run YurOTS 0.9.4f on 127.0.0.1:7171.
# Place original Tibia 7.6 assets in data/76/, or import both files in the browser.
npm start
```

Open http://127.0.0.1:8080. Use an existing YurOTS account, choose a character and enter the world.

## Game interface

The game fills the browser viewport with square tiles. Dark floating windows provide equipment/backpacks, battle targets, friends, chat and a session analyzer. Drag a window by its title bar, use the top toolbar to show or hide it, and use Reset panel layout to restore the defaults. Window positions and visibility stay in this browser.

The bottom HUD shows the server's health, mana and level progress. F1–F8 or clicking a shortcut sends its configured spell words; right click a shortcut to edit or clear it. F1 starts with `exura`, F2 with `utani hur`, and F3 with `utevo lux`; YurOTS determines whether the character can cast them. Shortcuts are inactive while typing or editing dialogs. Session experience and XP/hour use the actual experience change since login. On narrow screens the toolbar opens one window at a time; returning to desktop restores your windows. Saved positions are restored at the window size where you arranged them, with responsive defaults at other sizes.

Supported flows: character selection, map and floor updates, creatures/outfits, keyboard and click-to-walk movement, look/use/use-with, containers, equipment and item movement, chat/channels/private messages, spell words, attack and fight modes, visual effects, skills/stats, VIPs, outfit selection, text windows, trade and party messages. The server handles all game rules.

The DAT/SPR loader now correctly handles 7.6: 16-bit sprite counts and IDs, pre-enhanced-animation frames, 7.55+ item attributes, Z patterns and displacement. Matching original asset signatures are required; see `data/76/README.md`.

The gateway uses a fixed TCP destination and accepts only configured browser origins. `YUROTS_HOST`, `YUROTS_PORT`, `PORT`, `BIND` and `PUBLIC_ORIGIN` are environment settings. Use TLS termination and set `PUBLIC_ORIGIN=https://your-host` when hosting beyond localhost. Login credentials are never put in URLs or persisted by the client.

```sh
npm test                    # packet/framing and responsive viewport regressions, no server needed
npm run test:live            # browser login, map, movement, backpack, chat, outfit, logout
npm run test:advanced        # sample-world inventory, spell, floor and combat checks
npm run test:social          # two players: party, VIP, private chat, trade offers/cancel
CLIENT_URL=http://127.0.0.1:8080 npm run test:hud  # HUD, hotkeys, persistence, responsive clicks
```

The live tests require the sample YurOTS data pack and local 7.6 assets. `TEST_ACCOUNT`, `TEST_PASSWORD`, `TEST_CHARACTER`, and `CLIENT_URL` customize the basic browser test. Screenshots and JSON state go to `artifacts/`.

Scope: YurOTS protocol 760, one configured game server, original 7.6 assets. New account registration stays with YurOTS's existing account maker. The upstream Forby HTTP/token login and custom game protocol are not used in this mode.

The HUD suite defaults to Yurez The Next. Use `TEST_ACCOUNT`, `TEST_PASSWORD` and `TEST_CHARACTER` to select a separate test character that can safely log out; the suite casts `exura` and walks nearby.
