# Multiplayer update — architecture contract

This is the shared contract for everyone working on the co-op update. Keep it current when an interface changes.

## Goals
- 1–6 players. Solo play must keep working exactly as before (no network needed).
- Rooms with a 5-letter code; "quick match" puts you in a random public room (or creates one).
- Text chat (+ bubbles over heads), voice chat (WebRTC, push-to-talk or open mic), quick phrases, pings.
- Co-op is harder and needs teamwork (revives, two-player plates, boost jumps, co-op boss move), with a
  competitive layer (scoreboard, MVP, titles, walnut race, a PvP mini-mode).
- Per-player Tosha customization synced to everyone.
- DualSense / DualShock / Xbox pads over Bluetooth work in any modern browser.

## Backend
- Supabase project `gromadnoe-korolevstvo` (ref `xcgbfklgenhwztcpjdyp`, eu-central-1).
  URL `https://xcgbfklgenhwztcpjdyp.supabase.co`, publishable key `sb_publishable_vebpPhfIbBPIHl_vjgiDWw_2_qyGMfb`
  (public by design; override with `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY`).
- Supabase Realtime only carries LOW-volume traffic: lobby presence, room presence, signaling, chat, control
  messages, and a rate-limited fallback relay. Gameplay and voice go over WebRTC (full mesh, ≤ 15 links for 6).
- ICE: Google + Cloudflare + Twilio STUN by default; optional TURN from `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS`.
- `?net=local` switches signaling to a BroadcastChannel transport (same-browser tabs) for offline tests.

## Layers (src/net)
| file | role |
|---|---|
| `config.ts` | URL/key/ICE/protocol version/limits |
| `profile.ts` | my id (per tab, sessionStorage), name + look (localStorage) |
| `signal.ts` | transport interface + Supabase implementation + BroadcastChannel implementation |
| `lobby.ts` | public room directory (presence on `gk-lobby`), quick match |
| `room.ts` | room channel `gk-room-<CODE>`: presence (members), chat, signaling, control, relay; host election |
| `mesh.ts` | RTCPeerConnection per member, perfect negotiation, data channels `u` (unordered, no retransmits) and `r` (reliable), one audio transceiver |
| `voice.ts` | mic capture, PTT/open mic, speaking detection, per-member volume/mute, WebAudio mix (3D / flat voices, master volume) |
| `session.ts` | `net` singleton used by the game (see API below) |
| `protocol.ts` | message types, quantization helpers |

### `net` API (src/net/session.ts)
```ts
net.active: boolean                // in a room
net.myId: string; net.isHost: boolean; net.hostId: string | null
net.members: Map<string, Member>   // includes me; Member = { id, name, look, ready, joinedAt, ping, link: 'p2p'|'relay'|'connecting', turn, speaking, muted }
net.code: string | null; net.isPublic: boolean
net.create(opts: { public: boolean }): Promise<string>  // returns code
net.join(code: string): Promise<void>
net.quickMatch(): Promise<string>
net.leave(): void
net.send(to: 'all' | 'host' | string, type: string, data: unknown, reliable = true): void
net.on(type: string, cb: (data: any, from: string) => void): () => void
net.onMembers(cb: () => void): () => void      // join/leave/meta change/host change
net.setMeta(patch: Partial<{ name; look; ready; scene }>): void
net.chat(text: string): void; net.onChat(cb: (from, text, ts) => void)
net.voice: { enabled; ptt: boolean; talking: boolean; enable(): Promise<boolean>; disable(); setPTT(b); setTalking(b); setVolume(id, v); mute(id, b);
             volume; setVolume(v) /* all voices: slider 0..1 */; spatial; setSpatial(b) /* 3D voices in levels, off = «рация» */ }
net.time(): number                 // host-synchronized clock in seconds
```
Message rules: reliable channel for events; unreliable for state streams. If a link is not up yet,
`send` falls back to the Supabase relay (reliable only, max ~5 msg/s per client; state streams are dropped).

## Game model
- `Level3D.player` stays the LOCAL hero. `Level3D.players: HeroLike[]` = local hero + `RemoteHero3` proxies.
- AI/targeting never reads `L.player` directly: use `L.targetFor(pos, opts)` (nearest alive, visible) and
  `L.alivePlayers()`. Damage to any hero goes through `hero.hurt(L, dmg, from, knock?)`; for a remote hero
  on the host this sends `hurt` to its owner, who applies it locally.
- Authority: the HOST simulates enemies, boss, arenas, triggers, checkpoints, exits. Clients run the same level
  build; their enemies are puppets updated from host snapshots. Each client simulates its own hero.
- Hits ON enemies are detected by the attacker's client and sent to the host (`hit`).
- Projectiles / fallers / shockwaves / bombs are spawned by the host (`spawn` events) and simulated on every
  client; each client applies their damage only to its own hero (victim-side), the host applies damage to enemies.
- Loot is instanced: each client spawns its own drops when it sees an enemy die. Walnuts/artifacts are per player.
- Environmental actors that only threaten the local hero (feast King's snacking hand, noodles, book traps) run
  locally on each client. Shared bosses/enemies (spaghetti monster, chase King, throne King) are host-driven.

(The per-entity replication table and the 30-feature list are appended below once the code map is done.)

## The 30 features of the update
Connection & rooms
1. Rooms by 5-letter code, up to 6 players, public or private.
2. Quick match with random players (public rooms in the lobby state).
3. Lobby scene: all Toshas stand together; Ready toggles; host picks chapter + difficulty (лёгкая / нормальная / хардкор), can kick.
4. Text chat in lobby and in game (T), speech bubbles over heads.
5. Voice chat: push-to-talk (V / touchpad) or open mic, "speaking" icon over heads and in lists, per-player volume/mute.
6. Quick phrases (1–4 / D-pad): «Сюда!», «Помогите!», «Спасибо!», «Вперёд!».
7. Pings (G / L3): a glowing marker on ground/enemy that everyone sees, with an off-screen arrow.
8. Resilience: reconnect, host migration (restart from last candle), join between chapters, ping indicator.
Tosha
9. Editor: 8 hats, 4 back items, colours for hat/scarf/shirt/shorts/boots/back.
10. Name + player colour: nameplate over the head, coloured off-screen marker.
11. Emotes (B / R3): wave, dance, bow, facepalm.
Co-op
12. Downed instead of dead: crawl, friends revive (hold R / R1 nearby); not revived → back at the last candle; all down → team restarts from the candle.
13. Scaling by player count: enemy HP, bigger ambushes, angrier King.
14. Boost jump: land on a friend's head and jump again — super jump to secrets.
15. Two-player plates: plates that need two heroes standing on them open co-op stashes (every chapter).
16. Gifts: give a friend a honey jar or 10 crumbs (stand close, hold R).
17. Rescue: hit the noodle / monster tentacle / King's fist that holds a friend to free them.
18. Team clap: two players hitting the King's two stuck palms within 0.6 s stun him («Командный хлопок»).
19. Chase together: the King hunts the last runner; a straggler who falls too far behind is tossed forward to the group, losing a heart.
20. Shared candles: one lights it for everyone; late joiners/respawns appear at the latest candle.
21. Exit together: the door opens when the whole living team is at it (or after a 20 s countdown once someone arrives).
    Hardcore: no countdown — every hero in the level (downed / dead ones too) must be up and at the door.
22. Team den: everyone shops on their own, then Ready → host continues.
Competition
23. Scoreboard (Tab / Share): crumbs, kills, damage, revives, downs, ping.
24. Chapter results for the team: MVP and joke titles (Гроза арбузов, Ангел-хранитель, Крошкоед, Камикадзе…).
25. Walnut race: announcements «Вася нашёл золотой орешек!», most walnuts shown in results.
26. Combo streak: hits in a row without taking damage; best streak in results.
27. The King hates the leader: in the boss fight he prefers the score leader; the leader wears a crown icon.
28. Mini-mode «Крошечная лихорадка»: 2-minute PvP crumb grab on the feast table; hits make rivals drop crumbs.
Gamepads
29. DualSense / DualShock / Xbox over Bluetooth in any browser: correct layout, hot-plug, «Подключён DualSense» toast.
30. PlayStation/Xbox button glyphs in prompts, rumble on hits/damage, full menu/lobby/shop/editor control from the pad.

## Game-side core (implemented — build on it, don't redesign it)
Files: `src/three/game/netLevel.ts` (NetLevel, Netted, NET_SPAWN, GM), `remoteHero.ts` (RemoteHero3, HS/HF state layout),
`coop.ts` (session state: started, cfg.easy / cfg.hard (`coop.easy`, `coop.hard`, `coop.diff`), players, hpScale(), mySeen), `coopFlow.ts` (host moves the room between
story steps; clients follow without touching their solo progress; COOP_SCENES registry), `level.ts` (below).

Level3D in co-op (`L.nl` is a NetLevel, `L.mp === true`):
- `L.authority` — true in solo and on the host. Only authority runs AI / damages enemies / decides triggers, arenas,
  candles, exits. Clients see puppets.
- `L.player` = my hero. `L.heroes()` = mine + friends (`HeroLike`), `L.alivePlayers()`, `L.targetFor(pos)`,
  `L.remote(id)`. `hero.hurt(L, dmg, from, knock?, knockT?)` — for a friend on the host this sends `hurt` to its owner.
  Never write `p.body.vel` of a target after hurt — pass `knock` instead.
- `L.meleeHit(...)` on a client = prediction (pogo/hit-stop) + `melee` message; the host resolves it with
  `L.attacker = <friend id>` set (enemies read it for sneak attacks / credit). Peas: the host flies the real pea.
- `L.dropPickup(kind, at)` on the host = drop on every machine (instanced loot). `L.feed(text, color)` = event feed.
- `L.run(script)` on the host = everyone runs it (dialog lines auto-advance in co-op, each stays up 1.2 s + 0.06 s per character — `Dialog.hold`). `L.worldCut` = a story
  beat is playing (freeze the world like the solo cutscene check `letterboxTarget > 0.5` did).
- Shared: candles (`L.lightCandle(i)`), arenas (`GM.arena`), exits (whole team at the door or 20 s; hardcore: everyone, no timer), team wipe
  (`L.teamWipe()`), my respawn at the candle (`L.respawnLocal()`), grabs across the network (`L.netGrab/netRelease`,
  a Netted thing that grabs implements `grabTip()` and `netReleased(L, who, why)`).
- `L.spawnEnemy(kind, x, y, z, o, key)` — runtime enemies (waves, summons, splits) appear on every machine.
- Effects inside enemy/boss/chaser/actor updates on the host are captured (fx, sfx, shake, toast, banner, bark,
  shout) and replayed on clients automatically. Effects in client-side sims (projectiles, bombs) run locally.
- Plugins: `LEVEL_PLUGINS.push((L) => ({ update(dt), draw(ctx), dispose(), wantsInput() }))` — feature modules
  never edit level.ts.

Replicating a thing (`Netted` in netLevel.ts):
- Build-time things: `L.nl?.add(thing)` while `L.building` → same id on every machine. Runtime things on the host:
  `L.nl?.spawned(thing, kind, args)`; clients create them with `NET_SPAWN[kind](L, args)`.
- `netSnap(): number[]` (host, ~12 Hz, skipped beyond `netFar` m from every hero) / `netApply(a)` (client).
- `netEvent(L, ev, data)` for one-offs; `L.nl.entEvent(thing, ev, data)` sends to the host (from a client) or to all
  (from the host). `L.nl.gone(thing, how, at)` on the host → clients get `netEvent(L, 'gone', …)`.
- Enemy3 already replicates [x,y,z,yaw,flash,hp] + `netExtra()`; on clients `update()` runs `puppet()`.

Story scenes and ambushes (level flow in co-op):
- One story scene at a time: the host starts one (trigger / exit / start script) only when none is running and never
  two in one frame. A client that gets a new `GM.script` while its own copy of the last one is still playing ends that
  copy first (it is late or stuck).
- Watchdog (co-op only): a step of a story scene (a line, a camera move, a wait) that hasn't finished after 20 s is
  skipped (`[level] … a step hung` warning; errors inside a scene skip the step too); a scene still on after 120 s
  (the longest real one, `pantry_bear`, ≈ 75 s) is force-ended — on the host for everyone (`GM.script` with name `__cutEnd`), on a
  client 10 s later on its own. A force-ended exit / victory scene still ends the chapter.
- `L.say()` resolves when the dialog box is closed under it (another scene ended, a force-end) — a closed box used to
  hang the waiting scene forever (and with it `worldCut`: frozen enemies, no triggers, no exit).
- Ambush (`L.arena`): when it starts, every alive, non-downed hero who isn't inside the ring is moved in by his own
  machine (puff + «Засада! Все в круг!») — also after a respawn / revive / late load while it runs. If the host sees no
  living hero inside for 3 s, the bars sink (`GM.arena` state `open`) and the waves are fought around the ring; the
  prize still needs every wave beaten. The host repeats a running ambush's state every 3 s (late loaders).
- Ambush prizes are per hero (`L.prize`); in co-op an ability (feather / cloak / fork) not picked up after 5 s flies
  to its hero once he's up (dead, downed, far away). A rebuilt level (respawn, team restart) puts back an ability prize
  of a won ambush for whoever still lacks that ability (solo too).
- `L.teleportMe(at, yaw?)` moves MY hero at once (pull-ins, script gathers): friends' copies jump, not slide.

## World map & episodes («Хрумляндия»)
- Registry: `src/three/game/episodes.ts` — `EPISODES` (id, series number `n`, title, arc, map `node`, `levels`, `unlocks`,
  `links`, `hub` / `soon`). The prologue (series 1) is the STORY chain; other episodes play `levels` in order (Level3Def ids,
  or `'scene:<id>'` from `EPISODE_SCENES`); an id that isn't built yet plays the «Серия в разработке» card
  (`scenes/episodeStub.ts`). Adding an episode = one entry + its level ids. Progress: `save.data.episodes[id] = { done, medal, at? }`,
  `save.data.mapAt`; saves that reached the ending before the map existed count the prologue as done (`migrateEpisodes`).
- Solo: `game.play(run)` / `game.advance()` walk an episode (`game.run`), its end → `completeEpisode` → `game.toMap()`. The
  prologue's credits call `game.endPrologue()` → the map. Main menu «Продолжить» → the map once the prologue is done.
- Map scene `src/three/scenes/worldMap.ts` (`WorldMap3D`, `worldMap = true`). Co-op: scene message `kind: 'map'` carries the
  host's progress `prog` (`coopFlow.mapProg()`: a new host keeps the room's open nodes), the host's node `at` and `fin` (the
  episode just finished — every machine that played it records it; resent copies drop `fin`). On the map: `mapfig` (u, everyone:
  my figurine x/z/yaw/walking/node, ~8 Hz moving, 1 Hz standing + reliable on arrival) and `mapsel` (host: the room's choice
  { n, f, s, sub } on change + every 2.5 s with `prog`). Clients see the host's card and press «Готов» (meta `ready`);
  the host starts: `coopFlow.hostEpisode(id, step)` (levels: `GM.level` with `ep`; scene steps: scene `kind: 'scene'`),
  `stepDone()` ends a scene step; past the last step → `hostMap(id)`. Late joiners on the map get the map scene; a host
  change on the map just hands the driving to the new host. Lobby start option: `coop.cfg.chapter = MAP_CH (-1)` =
  «Продолжить на карте» (host's prologue done), else «Пролог: глава N». After the prologue's credits the room goes to the map.

- Story flags (episodes.ts `setStoryFlag(f)` / `hasStoryFlag(f, prog)`): story beats that open map nodes, kept in the same
  progress record as entries `@<flag>` ({ done: true }) — saved, merged by `coopFlow.mapProg()` and sent with the map
  messages like episodes, so in co-op the host's progress decides. `Episode.flag` = opens when that flag is set
  (`fangs1` ← `hub_lab_plan`, the hub's lab scene 4.4; the prologue now opens only `hub`); `Episode.lockHint` = the locked
  card's line. `migrateEpisodes` sets the flag for saves that already played / finished part of the arc.

## Hub town («Пастильное королевство», src/three/game/arc/town/)
- `buildTown(L, { night?, pal?, sky?, lampLights?, noHubProps?, notes?, gateLabel? }) → TownLayout`: sky / hills / ground /
  creek + every prop, merged per district (few draw calls). The layout object has the named spots (spawn, gate zone,
  square, fountain, shop keeper / counter, mirror, lab door / princess, board, clock tower, bakery, post, stalls, benches,
  lamps, houses with eave / ridge, the rooftop route, towers, bridges, streets, walk loops, creek, bounds). Night =
  `NIGHT` palette (lit windows / lamps, ≤ `lampLights` real point lights); `__goLevel('town_night', 0)` previews it (dev).
- Prop kit `townProps` (props.ts): marshmallowTower, gingerHouse (stepped roof colliders — roofs are walkable),
  marmaladeLamp, pastilaBridge, caneFence, candyTree, fountain, laboratory, clockTower, castleGate, marketStall,
  shopHouse, heroMirror, noticeBoard, candyBench, flowerBed, candyCrate, honeyBarrel, townWall, townSignpost, …;
  townsfolk rigs `createFolk(kind, look)` (people.ts; `grey` 0..1 drains the colours for the night's пресняки).
- Speech for the arc's new speakers (speech.ts): `say(L, id, text, expr)` — Пастила / Ноки / Пряник / Ириска / townsfolk
  speak through the level's dialog box (same timing, co-op auto-advance) with a candy portrait; a `Who` added later wins.
- The hub level `hub` (hub.ts, `castScenes: true`): free walk, no enemies. Personal things run only on my machine (the
  shop overlay = the den's DenScene with a `ShopHook`, so purchases are per player and carry over; the mirror →
  `openHeroPicker`; the board; talks; the bear's intro 4.2; the mirror scene 4.5; the training course 4.6). World scenes
  (4.1 arrival on the host's first visit; 4.3 + 4.4 when anyone walks into the lab — sets the `hub_lab_plan` flag on
  every machine that played it) go through `L.run`. Townsfolk walk on the room clock (`net.time()`), so everyone sees
  them in the same place. The gate: solo → the map at once; co-op → the host's 3 s countdown (`town_gate` message shows
  it to all) → `coopFlow.hostMap()`; a client in the gate gets a toast. `TOWN_HOOKS` (hooks.ts) lets other modules
  replace the mirror's picker or add lab scenes per arc stage.

## Difficulty & the library falls
- Room difficulty: `coop.cfg { easy, hard }` (never both). The lobby sends it in `lobbycfg { ch, easy, hard }`; every level
  message (`GM.level`) and scene message carries `easy` + `hard`, and the host sends `lobbycfg` to newcomers, so late joiners
  and a new host keep it. Solo has only easy / normal (`save.data.settings.easy`); `coop.hard` is false outside a co-op game.
- The library (`Level3Def.fallToFloor` with `fallLimit`): a fall longer than the limit costs nothing and moves you nowhere —
  you land on the floor (tumble, dust, «БУМ!», now and then a line) and climb again. Candles don't light for a hero dropping
  past them; below `killY` you are put back on the floor at the start.
- Hardcore (co-op only): that fall knocks you out where you land (`Player3.fallKO`: no bleed-out; `down` messages carry `f: 1`)
  until a friend comes down and revives you; all heroes down → the normal team wipe. Exits need everyone (above). Enemies have
  ×1.3 HP on top of the party scaling (`coop.hpScale()`), heart drops are halved. Shown in the lobby, the pause menu, a
  ☠ ХАРДКОР badge in the HUD corner and on the results card.

## Network layer notes (protocol v2)
- PROTOCOL_VERSION 2: older builds can't join newer rooms.
- Signaling goes to each member's private inbox `gk-room-<CODE>-<id>` (REST posts, queued and retried); ICE candidates
  ride inside the offer/answer. Presence is limited to 4 updates / 30 s per channel (Supabase closes a channel above
  5 / 30 s), so presence can lag ~30 s; fast meta changes travel in a ≤1/s coalesced broadcast.
- Host = (term, id, instance): the host keeps the seat until nobody has heard it for ~5 s (~13 s while someone's direct
  link to it is still up — a busy page, not a dead one; gossiped so everyone uses the same limit) or it leaves; everyone
  then elects the earliest-joined live member at term+1. The room clock (`net.time()`) stays continuous across hosts.
- Reliable messages carry per-pair sequence numbers on both paths (direct and relay) and are reordered on receipt.
  Unreliable messages go over the relay too, newest per (type, target), ≤2.5 batches/s — except the streams in
  `LIMITS.relaySampleHz` (`st` 10 Hz, `snap` 5 Hz): their samples since the last batch ride along, so the receiver can
  replay them smoothly (~0.5 s late) instead of jumping.
- Smooth movement (`src/three/game/netInterp.ts`): friends' heroes (`st`, 15 Hz real time, stamped with the sender's
  clock `HS.ts` and teleport counter `HS.tp`) and enemy puppets (`snap`, 12 Hz, host clock) are played back in the past
  between samples with an adaptive per-stream delay (~0.1 s direct, ~0.25 s on a jittery link, ~0.5 s relayed).
  `RemoteHero3.pos` is the drawn (played-back) position and what all logic reads; `latestPos` is the newest received.
  Moving MY hero without walking (respawn, toss, script placement, arena pull-in…) → call `player.teleported()` (or
  `L.teleportMe`) so friends see a jump, not a slide. `Netted.netApply(a, t)` gets the snapshot's host time.
- Bosses and big puppets play back the same way (chase King + wall + gate, throne King + palms + telegraphs + meatballs,
  feast King + servants, spaghetti monster, co-op plates): one NetTrack per moving part, all fed the snapshot's time and
  evaluated at `NetLevel.playT`; discrete state (attack / hand states, flags, smashed props, lanes, meatballs) is handed
  out as the playback passes it (`NetTrack.passed`), continuous fields (face, timers) are read with `NetTrack.lerp`.
  A jump that isn't movement goes out as a teleport counter (the chase King's front stepping back) so clients step.
  What a client simulates itself for a puppet (a palm's fall, a sweep / clap / lunge at the sent speed, rolling
  meatballs, a lash's clock, the chase King's slam palm after the played-back target) steps by `NetLevel.playDt` — the
  playback's own advance — so it stays in step with the played-back snapshots and a lost one can't cut a move short.
  Fast parts give their NetTrack a bigger `errSnap` (a late sample's correction fades instead of popping).
- Host events that go with what a puppet shows are listed in `Netted.netTimed` (wall burst, gate drop, the feast palm
  landing, the throne King's KO and his crew's grab / fling, a stash opening): the host stamps `ent` messages with its
  clock (`ht`) and clients deliver them when the playback gets there (`NetLevel.atPlay`; ≤ 1.5 s late if snapshots stop).
  Events that act on MY hero (grab, hurt, toss, let go) stay immediate. A client presses co-op plates under the heroes
  it draws (its own and the friends' played back); only the host decides the opening.
- `?lag=<ms>&jitter=<ms>&loss=<pct>` simulates a bad network on everything this page receives (tests; `net.sim`).
- The Tab board shows each friend's ping and link: «прямая» / «через TURN» (getStats: relayed candidate pair) /
  «через сервер» (Supabase relay; a toast says so once).
- `create/join/quickMatch` reject with code `cancelled` when `leave()` interrupts them.
- TURN / ICE: `VITE_TURN_URL` (comma list) + `VITE_TURN_USER` + `VITE_TURN_PASS`, or a full JSON list in
  `VITE_ICE_SERVERS`. Recommended before a public release (players behind strict NAT otherwise fall back to the relay).
- Dev builds are silent (no music/sfx/voice) unless `?music=1`. Test browsers must run with `--mute-audio`.

## 3D voice chat (src/three/game/voice3d.ts + src/net/voice.ts)
- Every friend's voice runs through WebAudio: source → analyser (speaking) → member gain (volume / mute) → `flat` (both
  ears) or HRTF panner → `spat` (distance gain) → mix → master (settings volume) → speakers. The hidden `<audio>` per
  friend stays muted (Chrome only feeds remote WebRTC audio into WebAudio while an element plays it). No WebAudio → the
  elements play as before.
- In a co-op level the `voice3d` plugin calls `net.voice.frame3d(owner, ears, spots)` every tick: ears = the camera
  (position + forward + roll-free up, so left / right / behind / above match the screen), each friend at his mouth
  (`RemoteHero3.pos` + 1.25 — downed, dead and hidden ones too). Loudness: `voiceGain(d)` with d = distance to the nearer
  of my Tosha and the camera — full up to `VOICE_NEAR` 4 m, NEAR/(NEAR + 1.25·(d − NEAR)) after (−7 dB at 8 m, −13 dB at
  15 m), eased to silence between `VOICE_FADE` 26 m (≈ −20 dB at 30 m) and `VOICE_MAX` 45 m.
- Flat (as before): outside levels (lobby, den, story scenes, credits), on the results card, the PvP podium and with
  `save.data.settings.voice3d === false` («рация»). A friend not in my level (loading, his stream quiet > 4 s, waiting
  in the lobby) is flat at −6 dB while I'm in one. No frames for 1 s (a stuck / undisposed level) → flat.
- Settings: `save.data.settings.voice` (slider 0..1, default 0.8; gain = audio.ts `sliderGain`, like music) and
  `.voice3d` (default true) are applied by `voiceUI` (src/ui/voiceHud.ts) whenever they change; the settings panel also
  pushes them at once with `net.voice.setVolume(v)` / `setSpatial(b)`.
- Dev builds: the voices' master gain is 0 unless `?music=1`; tests measure the `mix` node (pre-master) with analysers.
- HUD: a friend talking off-screen gets a small speaker by his edge arrow (beside the name, fainter when far).

## Heroes («Хрумляндия»: Тоша, Бублик, Ноки, Пастила)
- Models: `createHeroModel(kind, look?)` (src/three/models/heroes.ts) → a `HeroRig` with Tosha's interface (root, update(dt,
  HeroAnim), weaponTip, look, setLook, dispose): every HeroState (idle … emotes, downed), talk, expressions, its own attack
  poses (`HeroAtk`: punch / mill / grab · axe / axeAlt / axeSpin / chord · syringe / flask) and kit visuals (`HeroAnim.fx`:
  HeroFx — reach, aim, bridge, puff, bat, glide, gadget). Feet at the origin, facing +Z, about Tosha's size.
  `HERO_INFO` (name, role, colour, abilities), `HERO_SLOTS` (each hero's colour slots). Dev page: /heroes-preview.html.
- Story cast NPCs: `L.npc('tosha' | 'bublik' | 'noki' | 'pastila', x, y, z, yaw)` (canonical looks; drive `n.anim` — a HeroAnim:
  state 'wave' / 'cheer' / 'talk'… — talk is automatic: lines of `hero` animate the cast's Тоша, `dog` Бублик, a Who named
  like the kind that NPC). Level3Def `castScenes: true` («сюжетный состав», GDD 8): while the bars are down every player
  figure (mine and friends', shadows, nameplates) is hidden; they reappear in place after. `L.castHidden` tells.
- Who plays what: profile.kind (persisted; profile.lookOf(kind) / setLookOf / setKind; meta `hero: { kind, look }` =
  `Member.hero`, `Member.look` stays the Tosha look). In a level: `heroKindFor(def)` (game/heroes): the prologue's
  chapters + PvP → Tosha, `def.hero` forces a kind, else each player's pick. `Player3.kind` / `Player3.kit`;
  `player.setKind(kind)` swaps live (friends see it from the state stream).
- Kits: src/three/game/heroes/<kind>.ts implement `HeroKit` (kit.ts: run / jump, pre / locked / moveMul / dash / dashTick /
  airJump / shoot / attack / processAttack / special / post / interrupt / reset / fx …); no hook = Tosha's code path, so
  Tosha is unchanged. New rebindable action `special` (C, pad ○/B; a hero without one dashes on it;
  dash on the pad is R2 only now).
- Net: hero state HS appended `kind` (KIND_IDS index) and `k0..k3` (the kit's visible state, `kitNet(kind)` codec);
  ATK_KINDS appended the new attack kinds. RemoteHero3 swaps its rig when the kind changes, plays the fx back between
  samples, and runs `remoteKitView(kind)`: Бублик's bridge is a row of solid discs (tag 'bridge') on every friend's
  machine (their own physics walks on it); puffed up his head collider gets `bounce` (trampoline). `HERO_BODY` = where
  a friend stands on each hero.
- Бублик: grapple rings `addGrappleRing(L, x, y, z)` (build them on every machine); ledges and enemies are hooked anyway.
- Picker: `openHeroPicker({ onPick?, onClose?, note? })` (game/heroes) opens «Выбор героя» over ANY scene (its own small
  renderer); the scene underneath keeps updating with `input.modal = true` (no actions) — safe in a co-op level.
- Kits in play (numbers are the balance knobs at the top of each file):
  - Тоша (tosha.ts): beyond the prologue `special` = «Геройский клич» (cd 20 s): he and every hero within 7 m get haste ×1.3
    for 5 s and a one-hit golden shield for 8 s (`Player3.buff('haste' | 'ward', s)`; the shield soaks the damage like the
    pot lid). In the prologue's chapters / PvP no special hook (the button dashes as before).
  - Ноки (noki.ts): axe chops (+1 dmg); hold attack after a chop → charge ≤ 0.7 s → slam (+2/+3 dmg in front, a shockwave
    around); glide (hold jump, ≤ 3 s); bat dash 0.6 s with a small body (flies under low gaps, stays a bat until there's
    room); shoot = «Щипок», a sonic note ≈ 10 m (1 dmg, kind 'pea', no ammo); special «Аккорд» (cd 7 s): 'chord' hit 6 m
    around + `vamp(L).chord` + `revealAround(10 m, 5 s)`, and every 30 s +1 ♥ for every hero in reach (her too). Slower
    in the light (`vamp(L).sunAt > 0.3`: walk ×0.7, swings ×1.2). ×1.5 vs vampires: `vampBane(L, kind)` (heroes/bane.ts,
    a leaf module) — Vamp3.hurt multiplies by it (axe / slam / chord kinds; the attacker is `L.attacker` or my hero).
  - Пастила (pastila.ts): syrup syringe (shared slingshot controls, no peas, kind 'syrup', cd 0.4 s); special = gadget
    (tap = use, hold = the wheel, stick / WASD picks): «Батут-пряник» (15 s, cd 18), «Сиропный щит» (4 s, 2.8 m, cd 12),
    «Маяк-солнышко» (`vamp(L).light` 6 m / 8 s in the arc, a lamp elsewhere, cd 20); `reviveMul: 2` (coopMechanics).
  - New HeroKit hooks: `fire(L, from, dir)` (own shot on the shared slingshot controls, ammo-free), `fireRange`,
    `reviveMul`, `hud(ctx, L)`; HeroFx `charge` (Ноки's charge, NET_KEYS noki = bat, glide, charge).
- Team hub `team(L)` (heroes/team.ts, a LEVEL_PLUGIN registered on the first createKit): kit events on message `hk`
  (owner → all; the caster decides who is in reach → `ids`, each owner applies to his own hero): chord (+1 ♥), call
  (buffs), pad / dome / beacon (world gadgets every machine builds: the pad is a real `bounce` CylCol tag 'pad' — walking
  onto it launches too; the dome pops `owner === 'enemy'` Shot3s inside it on every machine), slam ring, kit shots (flown
  everywhere, unreliable; the shooter's copy turns a hit into `L.meleeHit` at the impact point). HS appended `buff`
  (1 haste, 2 shield) → `RemoteHero3.buffs`; the hub draws the auras, the gadget icon over Пастила while she picks, the
  ability chip (bottom right: special glyph + cooldown) and a one-line hint the first time each hero is played.
  Other modules: `heroEvents(L).on('chord' | 'call' | 'syrup' | 'beacon' | 'pad' | 'dome' | 'slam', (ev) => …)` — fired on
  every machine, `ev = { e, at, r, secs, by, heal?, ids? }`. Late joiners don't get gadgets placed before they loaded.

## Вампирский набор («Ночь клыков»: src/three/game/arc/vampires/)
Shared kit for the episode levels of the vampire arc. Imported once from `arc/index.ts`; that registers the enemy kinds,
the per-level kit plugin, the toon-shader patch (grey zones) and the test level `vamp_test` (`__goLevel('vamp_test', 0)`).
Everything is co-op safe: the host simulates, clients play puppets back; calls on a client that change the world are
sent to the host. Import: `import { vamp } from '../vampires';` (from `arc/<episode>/…`).

Quick start (inside `build(L)` — everything placed at build time is replicated by build order, so place it there):
```ts
const V = vamp(L);
V.nightLook({ red: 1 });                 // night preset: moonlight, fog, sky gradient (0 = pale moon … 1 = Алая луна)
V.moon();                                // the big moon in the sky (+ stars); follows the night's colour
V.greyZone('square', [0, 0, 0], 16);     // a grey district: comes back by itself once its vampires/townsfolk are done
V.lantern(4, 0, 6);                      // «солнышко»: vampires keep out of its light circle
L.enemy('fanger', 2, 0, -3);             // + 'bat' 'flyer' 'mist' 'servant' 'brute' (and 'presnyak')
V.flock(0, 4, -8, 5);                    // 5 bats circling at y≈4
V.folk(-3, 0, 2, 'zefir');               // a пресняк ('zefir' | 'pryanik' | 'marmelad')
```
Runtime (scripts, bosses, hero abilities): `V.restoreZone(id)`, `V.light(at, { r, secs })`, `V.chord(at, r, by)`,
`V.syrupSpray(at, r, by)`, `V.restoreAround(at, r, by)`, `V.revealAround(at, r, secs)`, `V.bland(hero, secs)`,
`V.snuffAround(at, r)`, `V.alarm(at, r, hero)`, `V.onRestore(cb)`, `V.onZone(cb)`, `V.sunAt(p)`, `V.greyAt(p)`.

Enemies (`L.enemy` / `L.spawnEnemy` / arena waves; HP × party size as usual; options in `EnemyOpts`: `aggro`, `leash`,
`yaw`, servant `invisible`, presnyak `folk`):
| kind | who | HP | does | answer |
|---|---|---|---|---|
| `fanger` | Клыкарь | 3 | crouches (red spot ahead, eyes glow) → lunges and bites: −1 ♥ + «пресный» 2.5 s | dodge sideways, hit it while it recovers (×1.5) |
| `bat` | Нетопырь-разведчик | 1 | the first one to see you screeches → every vampire within 18 m hunts you; orbits, dives one at a time | swat them; they won't dive at a hero in light |
| `flyer` | Летучий клыкарь | 4 | circles high, marks a spot on the ground (red ring), dives at it, then lies dazed on the ground | step off the ring, hit it while dazed (×1.5) |
| `mist` | Туманник | 4 | turns to mist (can't be hit), drifts behind you, forms (blue ring) and claws; snuffs a lantern you hide under | turn around on the ring; hit it while it recovers |
| `servant` | Невидимка-слуга | 3 | invisible; shimmers just before a slap | light, dust, a hit, Ноки's chord show it |
| `brute` | Упырь-громила | 12 | raises his fists (growing red ring) → slam + a shockwave ring (jump it); puts out lanterns near; punches up close | keep out of the ring, hit him after the slam (×1.5) |
| `presnyak` | Пресняк | — | grey sleepy townsperson, harmless | stun (any hit) + sword hit / syrup spray; 'chord' or 'syrup' hits restore at once |

Every vampire keeps out of light (waits at the edge, hisses), burns and flees when caught in it and takes ×2 damage
there; a 'chord' hit stuns it 2.2 s and reveals it; a 'syrup' hit stings and slows it. Defeated vampires shrink into
a little bat that flies off to the castle (script, bible §13) — no blood. Making a new one: extend `Vamp3`
(vampires.ts: `ACTS`, `brain(L, K, dt)`, optional `netMore()`), add `ENEMY_KINDS.mykind = (p, o) => new My3(p, o)` and
`declare module '…/enemies' { interface ExtraEnemyKinds { mykind: true } }` (the small generic hook in enemies.ts).

Colour of the world (greyShader.ts + kit.ts):
- `V.greyZone(id, at, radius, { edge = 5, auto = 'clear' | 'none', amount = 1 })` (build time): everything inside goes
  grey per pixel (a patch of three's toon shader; at most 8 zones are drawn at once — the nearest), the fog washes out
  while you are inside. `auto: 'clear'` restores the zone when the vampires and townsfolk that live in it (spawn point
  inside) are all done; `'none'` = only `V.restoreZone(id)` (host / solo; ignored on a client).
- A restore is a warm front running out from the centre; then the zone is done for good: kept in `L.seen` (`'gz:'+id`)
  across respawns and team restarts. `V.zone(id).state` ('grey' | 'restoring' | 'done'), `V.onZone(cb)` on every machine.
- Characters keep their own colours: heroes are marked automatically; rigs of new enemies/bosses should call
  `markCharacter(rig.root)` (their materials must be their own — `Mats`). A marked rig can be greyed: `setGrey(root, k)` /
  `greyHandle(root)(k)` (that's how пресняки and bitten heroes look grey).

Light (kit.ts):
- `V.lantern(x, y, z, { lit = true, r = 5.5, relight = true, light = true, h = 2.4 })` (build time): a candy-cane post with
  a smiling sun; a warm pool on the ground shows its circle. A hero's sword swing or a pea lights an unlit one; brutes'
  slams, the mist and `V.snuffAround(at, r)` / `lantern.snuff()` put them out. Real PointLights: the first 6 lanterns
  of a level (+2 pooled for temporary lights) — the rest only glow (no light-count change after the first frame).
- `V.light(at, { r = 6, secs = 8 })` — a temporary sun (Пастила's beacon, a script): any machine, the host spreads it.
- `V.sunAt(p)` 0..1 (> 0.3 = vampires burn there), `V.sunAway(p)`, `V.litLanternNear(p, r)`.

Invisibility (invis.ts): `new Invisibility(rigRoot, blob)` on any enemy / boss; host: `think(dt, { sun, dust, moving, extra })`,
replicate `goal`, every machine: `apply(dt, goal)`; `reveal(secs)`. Dithered alpha (alphaHash), no outline or shadow while
hidden. `V.dustZone(at, r)` (pollen / flour: the invisible show half), `V.revealAround(at, r, secs)`.
Known gap: the slingshot's auto-aim still locks onto invisible enemies (level.ts `nearestTarget` / `aimTargetList`
don't know the flag — a one-line `if (e.invis && e.invis.vis < 0.3) continue` there would fix it).

Hero abilities → the kit (for game/heroes):
- Ноки's «Аккорд»: `L.meleeHit(center, dir, r, Math.PI, 0, atkId, 'chord')` — every enemy in reach gets a 'chord' hit
  (vampires stunned + revealed, пресняки restored; the host credits the score); or simply `vamp(L).chord(at, r, myId)`.
- Пастила's syringe: projectiles that call `e.hurt(L, dmg, from, 'syrup')`; the «пробный сироп» squirter [E]:
  `vamp(L).syrupSpray(pointInFront, 1.6, myId)` (restores only STUNNED townsfolk); her beacon: `vamp(L).light(at, { r, secs })`.
- Hit kind 'sun' = ×2 on vampires (a sun flash).

«Пресный» (the bite): host `V.bland(hero, secs)` — the owner's hero moves at ×0.55 (its physics step is scaled, the
controls aren't touched), every machine shows him grey with grey drips; `V.blandT` = my seconds left.

Night & moon (night.ts): `V.nightLook({ red, fog: [near, far], moonDir, dark })` → `NightCtl.set(red, secs)` (blend pale ↔
red, e.g. in a script); `V.moon({ dir, size, red, stars })` → `MoonCtl.set(red, secs)`. Scripts run on every machine,
so the same call from a story script looks the same for everyone. `moonDir` also drives the moonlight shadows.

Townsfolk (townsfolk.ts, `Folk3`): restored = a colour burst, a thank-you bark (script §4.11), 2 crumbs, then a happy
townsperson stays and potters about (a local actor on every machine). Counts like a kill (the restorer's score, the
level's «Враги» line), `V.restoredN / V.folkTotal` — the «Расколдовано N из M» counter at the top (levels with
townsfolk); restored ones stay restored after a respawn / team restart.

Net notes:
- Vampires are Enemy3: snapshot `[x,y,z,yaw,flash,hp, act, progress, sun, visibility, hunting, …netMore]`; telegraph
  rings, stars, mist, smoke are drawn on every machine from that state. The flyer sends its dive spot.
- Lanterns (`[lit]`) and zones (`[restored]`) are build-time Netted things in the host's snapshots (late loaders catch up).
- The kit is a Netted with the fixed id `KIT_NET_ID` (99001): host → all `bland`, `light`, `chordFx`; client → host
  `lightReq`, `chordReq`, `restoreReq`, `sprayReq`, `revealReq` (capped radii).
- Restores ride on `gone` (how 'restore', the bark index); deaths on `gone` (how 'die') add the bat-away effect.
- Effects each machine draws itself are wrapped in `ambient(L, f)` (never captured / re-sent by the host).

Music & sounds (src/engine/audio.ts): tracks `hub_day` (candy town by day), `night_town`, `swamp`, `garden`, `pass`,
`castle`, `vampire_boss`; sfx `batFlap`, `batScreech`, `bite`, `colorRestore`, `mist`, `hiss`, `lanternOn`, `snuff`, `drain`.
`renderOffline({ music | sfx, sec })` renders into an AudioBuffer through an OfflineAudioContext (tests: levels /
spectrum; nothing is played). Dev builds stay silent.
Positional sounds: `audio.sfx(name, { volume, pitch, pan })` — `pan` −1 … 1 sends the one-shot through its own
StereoPannerNode (dropped when the sound is over); arc/fangs3 `posSfx(L, name, at)` pans by where `at` is on screen and
fades with distance (Шёпот's whispers).

## Серия 2 «Клыки в пастиле» (src/three/game/arc/fangs1/) + the hub's interludes
- `fangs1_town` = the hub town at night (`buildTown(L, { night, lampLights: 0, noHubProps })`, the kit's night + red moon
  lifted over the town's sky dome). Scenes `fangs1_intro` (the grey wave: zones fade 0 → 1 on every machine; a watchdog
  force-end tidies up the same way), `exit_fangs1_town`. Districts = grey zones in route order (square → market →
  west «улица фонарей» → north; east optional): the market comes back when its ambush (arena 0) is won, the west when
  its four lanterns are lit and its vampires gone (host checks), the rest clear themselves. The grey veil on the clock
  tower and `L.exit` follow the zones on every machine; the goal arrow = `refs.goalHint` (the next grey district).
- `fangs1_roofs`: a rooftop district built from the town props (killY 3.5 + fallLimit: the streets are a pit).
  Scenes `fangs1_roofs_intro`, `fangs1_boss_intro` (trigger on the dome), `fangs1_boss_retry` (rebuild after a death /
  team wipe: the host runs it when someone stands on the dome), `fangs1_boss_defeat` → `exit_fangs1_roofs` (5.8, ends
  the level; a force-ended `exit_` still ends it).
- Граф Нетопырь (`Count3`, boss.ts): host sim, fixed id 940+, snapshot `[x y z yaw state st hp phase dark seq flash
  active laneA laneB stagger dur]`, NetTrack playback; `phase` / `flash` (red-moon flashes in phase 3) are host events;
  the dark (`dark` 0/1 → `darkK` on every machine) dims hemi / sun / background / the night's fog colour. Air hits
  (pea / syrup / chord / punch / a batted bomb / flying into a light) build stagger toward a knock-down (need 2 solo,
  +1 per two more heroes); damage only while he's down (≤ 30 % HP per knock-down). `MarshBomb` = host spawn
  `f1bomb` (each copy hurts only its own hero; `bat` / `boom` events). Solo only: the three story NPCs (not my hero)
  stand at the rim and knock him down if he's been up 15 s; in the dark Пастила drops a beacon by me.
- Story cast: `Cast` (cast.ts) — `L.npc` figures, marked as characters (they keep colour in grey zones).
  Solo in-level lines of the four: `companion()` (a top line, never the hero I play; co-op silent).
- The pocket squirter: [E] (interact) near a stunned пресняк → `vamp(L).syrupSpray` (mine, any machine).
- Hub interludes: `TOWN_HOOKS.labScene(stage)` → `hub_after_fangs1..4` (5.9 / 6.7 / 7.7 in the lab, 8.8 in the yard
  with the bear and Ириска) — the hub's host decides by the room's stage; a world scene. A hub plugin shows the stage:
  three flasks on a shelf in the lab fill (stage ≥ 2, 3, 4), the Солнечная пушка stands in the yard from stage 4.

## Серия 3 «Туманные топи» (src/three/game/arc/fangs2/)
- Level `fangs2_swamp` (castScenes), scenes `fangs2_intro`, `fangs2_fake` (trigger at the fork), `fangs2_boss_intro`,
  `fangs2_boss_retry`, `fangs2_boss_defeat` → `fangs2_ending` (card «Слеза светлячка», save id `fangs:tear`),
  `exit_fangs2_swamp` (Камыш's boat, opened by the ending). Special hook: blob shadows on the story four (Ноки has none),
  the boss's solo cast, retry after a restart. Plugin `fangs2Plugin`: the swamp's moving bits, mist fog, splashes.
- The bog: water at y 0, the hazard 1.5 m under it (you sink a moment first; safe spots above the water still count).
- Moving things need no replication: Камыш's ferry and the exit boat are functions of the room clock (`net.time()`),
  each machine carries its own hero; rotten planks sink under any hero this machine draws.
- Netted (build order): `FireflyJar` (`[broken]`, host decides; its swarms + a 60 s kit light along the trail), the
  kit's lanterns / zones (`village` auto-clear → the `Drawbridge` lowers via `onZone` everywhere; `house` restored by the
  defeat scene), enemies (+ `ghoul`, `bloodfrog` (leap spot in `netMore`), `wisp` (`[luring]`: its pull is applied by
  every machine to its own hero), `frogfolk` (kit townsfolk with a frog rig; candy barks are translated by `frogBarks`)).
- Мадам Морок (`Morok3`, fixed id 93100, made at build): host sim; snapshot `[form act st at atMax seq x y z yaw hp maxHp
  ax az bx bz tongue flash crows]`, NetTrack playback (`st`/`at` never run backwards inside an action). Crows fly by
  formula from the played-back form clock; dives (`dive`), crow deaths (`crow`), the copied hero (`fake` {w, k}) and
  `unmask` are timed events. Hits on heroes are victim-side (wolf charge, tongue line, belly-flop, crow dives, the copy's
  claw — a client sends `bit` so the host drains his colour); hits on her are host-resolved. The copy: a hero rig of
  a real player (his look, name tag drawn like a friend's), no shadow; unmasked by a hit, Ноки's chord (`meleeHit`
  kind 'chord' or the wrapped `vamp(L).chord`) or light (`sunAt` — Пастила's beacon, a «солнышко»). Solo: the story
  four on the veranda; in the copy phase they walk in among her, Пастила drops beacons / Ноки strums (GDD §8).

## Серия 4 «Стеклянная оранжерея» (src/three/game/arc/fangs3/)
- Level `fangs3_garden` (castScenes), scenes `fangs3_intro`, `fangs3_mirror`, `fangs3_boss_intro`, `fangs3_boss_retry`,
  `fangs3_boss_defeat` → `fangs3_ending`, `exit_fangs3_garden`; the special hook builds the story cast and the boss.
- Netted, build order: `BeamMirror` (`[step, locked]`; client → host `turn`, host → all `turned`, `shake`), `PollenFlower`
  (`[regrowing]`, host → all `burst`), the kit's lanterns / zones, enemies (+ `gflower`, grey flowers that bloom: kit
  townsfolk rules). Fixed ids: `Garden` 931 (level whispers `wh`), `Shepot3` 930+ (made after the build).
- Doors follow the mirrors on every machine; watering carts and sprinklers follow the room clock (`net.time()`), each
  machine carries / hits only its own hero. Footprints and mirror reflections are drawn by every machine from what it
  draws (played-back positions), so all see the same.
- Шёпот: host sim; snapshot `[x y z yaw state st visGoal hp phase dark seq flash active, 4 decoys × (mode x z)]`,
  NetTrack playback; whispers (`wh`), shard restyle (`shard`), `noon`, `phase` are host events. The kit's
  `revealAround` / `chord` are wrapped in this level so Ноки's chord, pollen bursts and scripts reach him; Пастила's
  beacon works through `sunAt`. Solo: the story helpers on the dome's balconies (GDD §8) light a beacon / play a chord
  when he has been unseen for a while.

## Серия 5 «Чёрный перевал» (src/three/game/arc/fangs4/)
Level `fangs4_pass` (castScenes, fallLimit 9.5), north (−Z) and uphill: rope bridges → wind ridge → cliff climb →
the bat swarm down a ravine → the cave → ruins (goats, the courtyard ambush) → the summit (Сёстры Близняшки) → the
campfire = `exit_fangs4_pass`. Scenes `fangs4_intro`, `fangs4_ruins` (party barks only, zero length),
`fangs4_boss_intro`, `fangs4_boss_retry` (trigger re-armed on every rebuild until `f4won`), `fangs4_boss_defeat` (8.5 +
8.6 + card; opens the exit at the fire). Party barks during play (8.2.1 / 8.2.2) go over the hero who plays that
cast member, else over mine with the name (cast.ts `partyBark`) — every machine shows its own, never captured.
- One clock for everyone (`net.time()`, the host's): `CrumbleBridge` (bridge.ts; fixed ids 94101–94103) — 'wave': the
  first hero on it starts a collapse at 5.6 m/s from the near end (`wave {t0}`, snapshot `[t0]`), planks hang back
  4.5 s after; 'step': each plank drops 0.6 s after a hero lands (`pl {i, at}`, snapshot `[n, (i, at)…]`). A client
  standing on a plank asks the host (`step`). Planks are tagged `'moving'`. `Wind` (wind.ts): gusts are a function of
  the clock (5.6 s: calm 3, warning 1, gust 1.6), no messages; each machine pushes only its own hero through a
  `phys.move` wrapper; lee boxes behind the concrete blocks.
- `BatSwarm` (swarm.ts, id 94130): host flies the front after the last runner (`[state, front, speed, stT, tp]`,
  NetTrack, a teleport counter on fall-backs); bites are victim-side (`caught` → host falls back 6 m); stragglers
  (≥ 24 m behind the group, or behind the swarm — a respawn at the plateau candle) are carried to the group by their
  own machine (`toss {to, s}`, −1 ♥, never the last). `start` / `gone` events; stops for good at the cave (`f4swarm`).
- `Goat3` (goat.ts, kind `goat`): grey goats, FolkLike (kit counter, grey zone, chord / syrup restore; any hit on a
  stunned goat restores it).
- `Twins` (twins.ts, id 94140, `L.boss` only from the intro to the defeat): host sim of both sisters — gaze cones,
  the rule «a sister is hurt only by a hero her twin isn't watching» (checked on the host with the attacker's position),
  shared life (a wound heals back unless the twin is hurt within 4.2 s co-op / 7 s solo), watch → combo (dashes / rings)
  → swap (a teleport, `tp`) → blind. Snapshot `[mode, phase, per sister 18 numbers]`, a NetTrack per sister; spikes are
  `spike {p, at}` on the shared clock (victim-side), dashes victim-side from the played-back state, rings are Wave3.
  Sister barks / hint toasts go out as `bark` / `toast` events. Solo: the story cast at the rim distracts / calls the
  opening / slows a gaze (GDD §8). A new host mid-fight carries on from what it was showing. Dev: `refs.f4.twins.debugKill(L)`.

## Серия 6 «Замок Полночь» (src/three/game/arc/fangs5/)
Level `fangs5_castle` (castScenes): bridge → courtyard siege → portrait hall → library → spiral tower → the roof
(Король Полночь) → dawn → the morning square (finale, built far east of the castle, x ≈ 400) → `exit_fangs5_castle` +
`exit_fangs5_letter` (two scenes for the watchdog; a force-ended one still ends the level: both start with `exit_`).
- Build-time Netted mechanics (mechanics.ts): `Siege` [state] — four kit lanterns lit at once open the portcullis
  (host decides, the sun burst kills the attackers, `f5_siege` in seen); `Candles` [n, wrongSeq] — candelabra are
  Hittable3 (predictHit on clients), a wrong one snuffs all and spawns a living portrait (`L.spawnEnemy`), solved →
  the King's portrait door swings (`f5_candles`); `Crumble` [state, t per step] — tower discs a hero stands on crumble
  (host sees every hero), fall, grow back; their colliders are tagged `'moving'` (never a safe spot).
- Story triggers are added as the level is cleared (every machine, from the replicated state), `refs.goalHint`
  points the arrow at the next lantern / candle / the ambush.
- Enemies (enemies.ts, Vamp3): `portrait` (hangs, wakes, drops face-down on a red frame), `bookbat` (perched until a
  hero comes near), `shade` (phase-3 imp, runs at Пастила; `refs.f5cannon` hooks).
- The King (boss.ts, `Midnight3`, NET_ID 950, not in `L.boss` until his fight starts so the goal arrow works before):
  every actor — the King, his twin, three false heroes, two shadow hands — is a `Slot` timeline (pos, yaw, act,
  elapsed, length, windup, sequence, target) in the snapshot; clients play positions back (NetTrack, playT), hand out
  the record with `passed()` and run the act clocks on `playDt`, so every machine draws the same telegraphs and tests
  only its own hero when a strike moment is crossed (victim side). Thrown swords: host event `blade` (netTimed),
  simulated everywhere; a swing knocks one back (host: a 0.6 s rewind along its path; clients predict at once);
  `reflect` event. Parry: a hit on him in the glint (the last 0.42 s of a windup; friends' swings get +0.35 s for the
  delay) → stagger; the swinger's own machine skips that cut. Barks over Пастила / the bell go out as `bk` events.
  Phase reached is kept in seen (`f5_ph2`, `f5_ph3`): a respawn / team wipe restarts from that phase (`fangs5_boss_retry`).
  A client loading into a running fight starts it at once from the snapshots. Dev: `refs.f5.boss.dev('p2' | 'p3' |
  'charge' | 'wings' | 'shape' | 'silence' | 'twins')`.
