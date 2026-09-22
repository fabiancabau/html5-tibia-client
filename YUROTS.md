# YurOTS / Tibia 7.6 mode

This fork adds a native 7.6 browser mode at `/yurots.html` (the default page when using the bundled gateway). The original Forby client remains at `/index.html`.

```sh
npm ci
# Run YurOTS 0.9.4f on 127.0.0.1:7171.
# Place original Tibia 7.6 assets in data/76/, or import both files in the browser.
npm start
```

Open http://127.0.0.1:8080. Use an existing YurOTS account, choose a character and enter the world.

Supported flows: character selection, map and floor updates, creatures/outfits, keyboard and click-to-walk movement, look/use/use-with, containers, equipment and item movement, chat/channels/private messages, spell words, attack and fight modes, visual effects, skills/stats, VIPs, outfit selection, text windows, trade and party messages. The server handles all game rules.

The DAT/SPR loader now correctly handles 7.6: 16-bit sprite counts and IDs, pre-enhanced-animation frames, 7.55+ item attributes, Z patterns and displacement. Matching original asset signatures are required; see `data/76/README.md`.

The gateway uses a fixed TCP destination and accepts only configured browser origins. `YUROTS_HOST`, `YUROTS_PORT`, `PORT`, `BIND` and `PUBLIC_ORIGIN` are environment settings. Use TLS termination and set `PUBLIC_ORIGIN=https://your-host` when hosting beyond localhost. Login credentials are never put in URLs or persisted by the client.

```sh
npm test                    # packet/framing regressions, no server needed
npm run test:live            # browser login, map, movement, backpack, chat, outfit, logout
npm run test:advanced        # sample-world inventory, spell, floor and combat checks
npm run test:social          # two players: party, VIP, private chat, trade offers/cancel
```

The live tests require the sample YurOTS data pack and local 7.6 assets. `TEST_ACCOUNT`, `TEST_PASSWORD`, `TEST_CHARACTER`, and `CLIENT_URL` customize the basic browser test. Screenshots and JSON state go to `artifacts/`.

Scope: YurOTS protocol 760, one configured game server, original 7.6 assets. New account registration stays with YurOTS's existing account maker. The upstream Forby HTTP/token login and custom game protocol are not used in this mode.
