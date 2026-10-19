Spot-check of the two maps against the current tree (read-only; nothing edited). Some files changed while I was reading: input.ts, pads.ts, glyphs.ts, models/hero.ts and src/net/*. Their keyboard and chat handling, gamepad support and hero-look code are already being written. Integration points that still remain are listed under F.

**A. Places where the maps contradict docs/MULTIPLAYER.md or are wrong**

1. **Who detects hits.**
   - The player-coupling map has the host run hits: `level.ts:383` meleeHit runs on the host, and `level.ts:443` makes peas host-simulated.
   - The contract ("Game model") says the attacker's client detects the hit and sends `MSG.hit`.
   - Pick one. Under the contract, `meleeHit` and `Shot3` player-owned hits (`objects.ts:79-97`) run on the attacker's client against puppets and emit `hit{netId, dmg, kind, atkId, from}`. The host keeps the `(pid, atkId)` dedup and the authoritative `Enemy3.hurt`.
2. **Who runs traps, noodles and the feast hand.**
   - The map makes these host-driven: traps (`level.ts:680`), noodle grab (`objects.ts:343`), feast snack hand (`feast.ts:364`).
   - The contract says they run "locally on each client".
   - Local noodles break feature 17 (cut the noodle holding a friend), because a friend's noodle isn't the same object on your screen.
   - The local FeastKing rolls its own random numbers (`feast.ts:251, 295, 376, 424, 448`), so every client sees a different hand. Remote heroes then get swatted and shoved by nothing (shove at `feast.ts:306-311`).
3. **Seeding `Noodle3.t` (`objects.ts:253`) is not enough.**
   - Swing phase comes from `this.t` (`objects.ts:297`), which counts from the moment that client finished building the level.
   - Hitstop also skips noodle updates (`level.ts:824` returns before `level.ts:840`).
   - Fix: derive phase as `net.time() - levelStartT + seed`, and do not advance it with local dt.
4. **Hitstop and slow-mo also desync clients, not only the host.** The map treats `level.ts:822-824` as a host-freeze problem only.
   - Client-side shots, fallers and waves stop updating during a client's own freeze, and run at ×0.35 during its death slow-mo (`level.ts:836-845` use the scaled `dt`).
   - They then lag the host by up to about 0.8 s, and victim-side damage tests run against stale positions.
   - Fix: replicated sims always step with `rawDt`. Freeze and slow-mo apply only to the local hero, camera and fx.

**B. Missed single-player assumptions in the loop and runtime**

5. **The host simulation is tied to `requestAnimationFrame`** (`main3d.ts:86-102`).
   - A hidden or minimised host tab stops the world for everyone.
   - `elapsed` is clamped to 0.1 (`:88`), at most 4 steps run per frame (`:92`), and `acc = 0` drops leftover time (`:99`). A slow host therefore runs the world slower than real time.
   - session.ts has no `visibilitychange` handling.
   - Fix: on the host, use a `setInterval`/worker fallback when `document.hidden`; catch up on `net.time()`; or hand off host when hidden for more than N seconds.
6. **`game.go` silently drops a second request while a fade is pending** (`game.ts:46`), and the scene does not update during a fade (`game.ts:87`).
   - A network scene-change that arrives during a local fade (respawn, menu) is lost.
   - The host world also pauses for the whole fade.
   - Fix: add an MP path that queues or overrides `pending`, and keep the host simulation ticking.
7. **Dialog lines advance only on local input** (`dialog.ts:53-56`).
   - Shared story scripts yield `L.say()`, so each client's script moves at its own player's pace and the host's script waits on the host player.
   - Fix: in MP use `auto` (`dialog.ts:58`) or a host-broadcast `dlgNext{line}`, plus a skip vote.
   - `cutscene(false)` closes any open dialog (`level.ts:631`), so a local item-get ending kills a shared line.
8. **`L.inCutscene` gates world AI and triggers.** It is `scripts.length > 0 || dialog.active` (`level.ts:623`), and the map only flagged `letterboxTarget`. Readers:
   - triggers `level.ts:669`, exit `:672`, arena start `:699`
   - walnut rain `boss.ts:216`, taunts `boss.ts:238`
   - snack hand `feast.ts:369`
   - A host's personal item-get coroutine (`level.ts:506`) or any local `runGen` stalls these for everyone.
   - Fix: add a separate `L.worldCutscene` flag, set by host-broadcast story scripts only.
9. **Teleports are not marked for puppets.** Without a marker, puppets lerp across the map through walls. Teleport sources:
   - `hazardHit` to `lastSafe` / `safeHist` (`player.ts:468-487`)
   - `reset` (`player.ts:79`)
   - grab pull-in (`player.ts:277-279`)
   - `exit_library` tween (`scripts.ts:233-238`)
   - chase_intro `pos.y += 1.8` (`scripts.ts:262`)
   - Fix: add a `tp` sequence counter to the `st` packet; puppets snap when it changes.
10. **Heroes have no collision with each other.** `PhysWorld.cols` holds static and active colliders only (`physics/world.ts:42-48`).
    - Boost jump (feature 14) needs a dynamic cyl collider per RemoteHero, tagged `hero`.
    - That tag must be excluded from the safe-ground filter (`player.ts:251`), `onLand` (`level.ts:341`), and enemy ground probes (`enemies.ts` `groundAhead`).
11. **Collider indices are not a stable ID.** The map's `land{colliderIdx}` relies on `phys.cols` order, which depends on:
    - `breakable()` skipping seen keys (`level.ts:253`)
    - special-hook colliders added after build (`throneBoss.ts:158`, `:169`; `chase.ts:51`; `spaghettiMonster.ts:52`)
    - Fix: assign `col.id` in `add` / `col` / `arena` (`level.ts:214-222`, `:309`).
12. **There is no load barrier.** The constructor builds, runs special hooks (`level.ts:205`) and starts `startScript` immediately (`level.ts:209`), so the host starts AI before slow clients have built the level. Fix: wait for every client's "loaded" ack, then the host broadcasts the start at a `net.time()` value.
13. **Net handler lifecycle.** `Level3D.leave()` only releases the pointer lock (`level.ts:910`), and respawn creates a new Level3D (`level.ts:773`). `net.on` subscriptions from the old level would keep firing. Fix: keep the unsubscribers and call them in `leave()`. Also queue network messages into the fixed tick rather than mutating state inside callbacks.

**C. Missed flow steps** (all per-save, per-client today)

14. **Each client advances its own story.**
    - `finishLevel` calls `game.advance()` / `game.story()` (`level.ts:760-768`).
    - `game.story` writes `save.data.story` / `reached` / `started` (`game.ts:59-70`), so MP progress overwrites the solo save.
    - Other local advances: `Den.leave` (`den.ts:181-183`), `Story3D.finish` (`scenes3d.ts:351-355`; skip by holding Esc at `:362`), credits hard-setting `story = 8` (`credits.ts:60-62`).
    - Chapter pickers gated on the local `reached`: `scenes3d.ts:149-151`, `den.ts:144, 187-189`.
    - Exits to the menu: pause `level.ts:894-895`, death menu `level.ts:804-805`, den `den.ts:145`.
    - Fix: in MP, scene changes come only from the host's `start` / `scene` messages; decide whether MP updates `reached`; turn menu/restart items into leave-room or restart votes.
    - `Menu3D.buildMain` (`scenes3d.ts:114-122`) has no "play with friends" entry.
15. **Difficulty is read from each client's own save.**
    - +3 max HP (`player.ts:82`), boss HP 160/220 (`throneBoss.ts:104`, fixed at construction), chaser speed (`boss.ts:128`), crumb loss (`level.ts:591`).
    - It can be toggled mid-level (`level.ts:891`) and in the menu (`scenes3d.ts:142`).
    - Fix: make difficulty a room setting from `lobbycfg`. Player-count scaling has to be decided at construction, which is a problem for late joiners.
16. **Results and kill credit.**
    - The medal requires `kills >= 85% of enemies` (`results.ts:37`). Kills split across 6 players make that impossible; use team kills for the medal and personal kills for the scoreboard.
    - `countKill` returns early when `e.key` is missing (`level.ts:259-263`), so boss summons, Jelly splits, spaghetti meatballs and chaser-trampled enemies never count. Kill credit needs its own path.
    - `save.data.bossBeaten` is set only where the boss dies, i.e. the host (`throneBoss.ts:1262`). Clients must set it on `bossDead`.

**D. Missed state and ID issues**

17. **`seen` mixes shared world state with personal pickup state.** It holds world keys (scripts `level.ts:619`, arenas `:310`/`:720`, breakables `:253`, enemy anti-farm keys `:228`) and per-player pickup keys (`'p'+seq` at `:241`, added on collect at `:469-470`).
    - If the host ships its `seen`, crumbs the host already picked up vanish from everyone's level.
    - Fix: split it into `worldSeen` (from the host) and `mySeen` (local).
    - `STATS` is a WeakMap keyed by the `seen` Set (`level.ts:65`, `:168-170`) and also needs to be per-pid.
18. **Special hooks branch on client-local state.**
    - Library: the exit zone is created only when `arenas[0].state === 'done'` (`scripts.ts:569`, `:577`), and the portal comes from the module global `LIB_PORTAL`. It needs the replicated arena state.
    - Chase: `retry = !!cp || L.seen.has('chase_intro')` (`scripts.ts:581`) decides the wall state, the chaser start and the retry countdown (`:615`).
    - Throne: `throne_retry` (`scripts.ts:630`), and `onDefeat` starts `throne_victory` on the host only (`:624`), so it must be broadcast.
19. **Placed crumbs are a design decision.** `crumbLine` / `crumbRing` / `pick` placed crumbs (`level.ts:275-280`) become instanced by default, which means no crumb race. Decide explicitly whether they are shared and host-arbitrated (competition) or instanced.

**E. Missed UI, sfx and fx coupling**

20. **About 80 `audio.sfx`, about 80 `L.fx.*` and about 40 bark/shout/toast/banner/shake calls sit inside host-only AI paths.**
    - Breakdown: enemies 22 sfx / 26 fx; throneBoss 31 / 18, plus 19 bark/toast/shake calls; spaghettiMonster 9 / 7, plus 10.
    - Arena banners: `level.ts:703, 717, 723`.
    - Puppet clients will be silent and show no effects. Fix: have puppets derive them from snapshot state transitions, or route them through a host `fx` event keyed by netId.
21. **Sound has no position** (`audio.sfx(name, {volume, pitch})`, `audio.ts:55`). Remote heroes' and far enemies' sounds would play at full volume. Fix: add `{at}` with distance attenuation from the local camera. Voice should also duck music, the way `dialog.say` → `duckMusic` (`dialog.ts:28`) does.
22. **The HUD toast queue is capped at 3 and dedupes by text** (`hud.ts:29-32`). Join, down, kill and chat feeds will push out hints; they need a separate feed widget. Chat bubbles can reuse `L.bark(obj, …)` (`level.ts:568`).
23. **Two tabs in the same browser share one save.** The localStorage save key (`save.ts:29-30`, `:80-81`) is the same for both, while the profile ID is per tab. Two-tab `?net=local` tests will clobber each other's save. Fix: suffix the key per tab in local-net mode.

**F. Integration points still open in the in-progress work**

24. **Hero looks are not wired through.** `createHero(look)` now exists (`hero.ts:263`), but every caller still passes nothing:
    - `player.ts:69`
    - Menu, den and story heroes: `scenes3d.ts:98, 292, 444, 495, 1083`
    - The 2D dialog portrait `drawHero` uses a fixed palette (`art/characters.ts:908`).
25. **Fast hazards and host-side hit checks (decision for the lead).** The map's host-side loops for fast hazards will feel unfair, because the host sees remote heroes about RTT/2 plus the interpolation delay in the past:
    - chaser catch `boss.ts:228`
    - BowlBall `bossParts.ts:168`
    - sweep, slam and clap `throneBoss.ts:981, 1021, 1039`
    - Prefer victim-side tests against replicated hazard state, as the contract already does for projectiles.