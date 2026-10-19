**Research report: gamepads over Bluetooth, Supabase Realtime, WebRTC (findings as of 2026-10-16)**

Sources were read directly where possible: Chromium, Firefox, WebKit and supabase-js source, plus MDN, Supabase, Cloudflare and Metered docs. Anything inferred rather than stated by a source is marked **[inferred]**.

## (A) Gamepad API with DualShock 4, DualSense and Xbox over Bluetooth

### A1. Is `mapping === "standard"`?

**Chrome and Edge on Windows**
- **Yes** for these pads: DS4 054c:05c4 and 054c:09cc, DS4 USB receiver 054c:0ba0, DualSense 054c:0ce6, DualSense Edge 054c:0df2, and 054c:0e5f.
- They are read through RawInput. Chrome maps them with `MapperDualshock4` and `MapperDualSense`.
- Source: https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/gamepad_standard_mappings_win.cc
- The flag `kIgnorePS5GamepadsInWgi` is enabled by default. It stops DualSense and DualSense Edge being counted twice (once by WGI, once by RawInput). It is present in Chrome 144 and later.
  - Source: https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/public/cpp/gamepad_features.cc

**Chrome and Edge on macOS, Chrome 147 and earlier**
- **Yes**, through IOKit HID with the same mapper functions.
- Source: https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/gamepad_standard_mappings_mac.mm

**Chrome and Edge on macOS, Chrome 148 and later**
- **Yes**, but by a different route. `kPlayStationUseGameControllerDataFetcherMac` and `kXboxUseGameControllerDataFetcherMac` are enabled by default from 148.
- I checked the release tags: the flags are absent in 143, disabled by default in 146–147, and enabled from 148.
- DS4, DualSense and Xbox pads now go through Apple's GameController framework (`game_controller_gamepad.mm`). It always sets `mapping = standard`.
- It adds the touchpad button at index 17 and touch events, and haptics through CoreHaptics.
- Source: https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/game_controller_gamepad.mm

**Firefox**
- The `Dualshock4Remapper` gives standard mapping for 05c4, 09cc and 0ba0.
- DualSense (0ce6) and DualSense Edge (0df2) only got standard mapping recently, in Bug 1849039 ("Add DualSense support to Gamepad API"). It shipped in Firefox 153 and was uplifted to 152.0.2.
- On older Firefox the DualSense was not standard:
  - the D-pad came through as an axis (one commenter saw it at `gamepad.axes[4]`);
  - the right stick's vertical axis was "connected to the trigger";
  - it reported 14 buttons wireless and 15 wired (the extra one is mic mute).
- Sources: https://bugzilla.mozilla.org/show_bug.cgi?id=1849039 and https://raw.githubusercontent.com/mozilla-firefox/firefox/main/dom/gamepad/GamepadRemapping.cpp

**Safari**
- Uses the GameController framework. `mapping` is `"standard"` whenever the controller has the extendedGamepad profile, which DS4, DualSense and Xbox do.
- Safari does not expose the touchpad button (17 buttons max).
- Source: https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/gamepad/cocoa/GameControllerGamepad.mm

### A2. Standard-mapped layout (PlayStation names)

**Buttons**
- 0 Cross, 1 Circle, 2 Square, 3 Triangle
- 4 L1, 5 R1
- 6 L2, 7 R2 — analog in `.value`, from 0 to 1
- 8 Share/Create, 9 Options
- 10 L3, 11 R3
- 12 Up, 13 Down, 14 Left, 15 Right
- 16 PS
- 17 Touchpad click — Chrome and Firefox only, `type` kTrackpad

**Axes**
- 0 LX, 1 LY, 2 RX, 3 RY
- Down and right are positive, matching the W3C standard layout: https://w3c.github.io/gamepad/

**Safari / GameController detail**
- Safari binds the GameController "Options" input to index 8 and "Menu" to index 9.
- On a DualSense that is Create → 8 and Options → 9, so it matches the layout above.

### A3. Raw HID indices (what a non-standard / raw pad exposes)

These are the inputs that Chromium's mac/win mappers and Firefox's remappers read, before remapping.

**Buttons**
- 0 Square, 1 Cross, 2 Circle, 3 Triangle
- 4 L1, 5 R1
- 6 L2 (digital), 7 R2 (digital)
- 8 Share/Create, 9 Options
- 10 L3, 11 R3
- 12 PS, 13 Touchpad
- DualSense wired adds 14 Mic mute.

**Axes**
- 0 LX, 1 LY, 2 RX
- 3 L2 analog, 4 R2 analog — both range −1..1; convert with `(v + 1) / 2`
- 5 RY
- 9 hat switch (the D-pad)
- Chromium's `MapperDualSense` copies `axes[2]` to right-stick X and `axes[5]` to right-stick Y.

**Decoding the hat value** (from `DpadFromAxis`)
- The value is −1 for up and rises clockwise in steps of 2/7 (about 0.2857), reaching +1.0 for up-left.
- At rest it is a value above 1 (about 1.2857). At startup it is sometimes 0.0.
- Thresholds used by Chromium and Firefox:
  - up: `v >= -1 && v < -0.7`, or `v >= 0.95 && v <= 1`
  - right: `v >= -0.75 && v < -0.1`
  - down: `v >= -0.2 && v < 0.45`
  - left: `v >= 0.4 && v <= 1`
- Source: https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/gamepad_standard_mappings.cc

**Firefox axis numbering for unknown devices**
- When Firefox has no remapper for a device on macOS, it numbers axes and the hat sequentially in HID element order, not by HID usage. So indices can differ from the list above.
- Source: https://raw.githubusercontent.com/mozilla-firefox/firefox/main/dom/gamepad/cocoa/CocoaGamepad.cpp

### A4. `gamepad.id` formats

| Browser / platform | Format |
|---|---|
| Chrome/Edge, Windows; Chrome ≤147, macOS | `"<HID product> (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"`. Without a mapping the `STANDARD GAMEPAD ` part is omitted. |
| Chrome/Edge ≥148, macOS (GameController path) | `"<GCController.vendorName> (STANDARD GAMEPAD)"` — no vendor/product hex |
| Chrome WGI path (Xbox) | `"... (STANDARD GAMEPAD)"`. Xbox 360 through XInput: `"Xbox 360 Controller (XInput STANDARD GAMEPAD)"` |
| Firefox, macOS and Windows | `"%04x-%04x-%s"`, e.g. `"054c-0ce6-DualSense Wireless Controller"`. XInput pads on Windows: `"xinput"` |
| Safari | `"<vendorName> Extended Gamepad"` |

- For the Chrome ≥148 macOS row, examples would look like "DualSense Wireless Controller (STANDARD GAMEPAD)" or "Xbox Wireless Controller (STANDARD GAMEPAD)" **[inferred: exact vendorName strings not verified]**.
- **[inferred]** The DS4's HID product string on Windows is commonly just "Wireless Controller".
- Consequence: a regex on `054c`/`0ce6` fails on Chrome ≥148 for macOS and on Safari. Use `mapping === "standard"` first, then a name match (`/dualsense|dualshock|wireless controller|054c/i`), then raw fallbacks.
- Sources:
  - https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/gamepad_data_fetcher.cc
  - https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/wgi_data_fetcher_win.cc
  - https://raw.githubusercontent.com/mozilla-firefox/firefox/main/dom/gamepad/windows/WindowsGamepad.cpp
  - the WebKit file above

### A5. Known quirks

**Pads appear only after input**
- The spec hides pads until a "gamepad user gesture" (a button press or stick movement). Until then `getGamepads()` is empty and `gamepadconnected` does not fire.
- Safari also counts "wiggling the joystick with intent".
- Show a "press any button" prompt and poll every frame. Do not rely only on the event.
- Sources: https://w3c.github.io/gamepad/ and the WebKit file above

**Secure context**
- Firefox 81+ returns `[]` from `getGamepads()` on insecure origins; localhost counts as secure: https://hacks.mozilla.org/2020/07/securing-gamepad-api/
- Chromium also restricts insecure origins; I could not confirm the exact milestone. Serve over HTTPS.
- The permissions policy `gamepad` default allowlist is `*`. Iframes may need `allow="gamepad"`.

**Snapshots**
- `getGamepads()` returns a snapshot, so call it again every frame.

**Duplicated pads**
- Chrome on Windows before 144: a DualSense could appear twice (WGI plus RawInput). Fixed by `kIgnorePS5GamepadsInWgi`.
- Steam Input or DS4Windows create a virtual Xbox 360 pad, so the same controller shows up twice (physical plus XInput). Steam can also hide the DualSense from non-Steam apps.
- Mitigation: dedupe by matching input activity, and let the user pick the active pad.
- Sources:
  - https://steamcommunity.com/groups/SteamClientBeta/discussions/0/3409804429012214734
  - https://portablefreeware.com/forums/viewtopic.php?p=100708

**Phantom or dead DualSense over Bluetooth [inferred]**
- By default a DualSense on Bluetooth sends the simple report 0x01. Once software requests calibration (Steam, DS4Windows, WebHID pages, the Linux kernel driver), it switches to the extended report 0x31.
- Per the Wine thread, after that switch the controller "no longer works through DirectInput" until reconnected.
- Chrome's RawInput path has special report handling only for the DS4, so a DualSense may show no input in Chrome until it is re-paired.
- Sources: https://source.winehq.org/patches/data/224112 and https://source.winehq.org/patches/data/224002

**Slots**
- Chrome's `kItemsLengthCap` is now 8 (it was historically 4).

**Xbox over Bluetooth on macOS**
- Older Chrome had firmware-specific mappers: `MapperXboxBluetooth`, `MapperXboxSeriesXBluetooth`, `MapperXboxElite2Bluetooth`. A 2019 firmware update changed the 045e:02fd layout, and re-pairing sometimes fixes bad mappings.
- From Chrome 148 Xbox pads also use the GameController path (standard mapping). The Share button is index 17, and Chromium notes GameController "doesn't detect share button presses over USB".
- Sources: https://codereview.chromium.org/2798933004 and the gamepad_standard_mappings_mac.mm link above

### A6. Vibration (`vibrationActuator.playEffect('dual-rumble')`)

**Support table (MDN BCD)**
- `vibrationActuator` / `playEffect`: Chrome 68, Edge (Chromium), Safari 16.4.
- Firefox: no — haptics are a TODO on Windows and macOS (Bug 680289).
- Safari iOS: no.
- `trigger-rumble`: Chrome and Edge 126 only.
- Sources:
  - https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/GamepadHapticActuator.json
  - https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Gamepad.json

**Chrome on Windows**
- DS4 rumble works over USB and Bluetooth (uses Bluetooth output report 0x11).
- DualSense and DualSense Edge have no vibration: `SupportsVibration()` is true only for the DS4 class or a short HID-haptic list (XSkills, Stadia). `vibrationActuator` is therefore null or unsupported **[inferred from source]**.
- Sources:
  - https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/raw_input_gamepad_device_win.cc
  - https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/dualshock4_controller.cc
  - https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/hid_haptic_gamepad.cc

**Chrome ≥148 on macOS**
- Any pad whose GameController haptics report left and right handles gets dual-rumble. Pads with trigger localities get trigger-rumble.
- **[inferred]** This should cover DS4 and DualSense over Bluetooth.

**Safari on macOS**
- Advertises dual-rumble or trigger-rumble from the GameController haptics localities.

**Hidden tabs**
- `playEffect()` rejects while the document is hidden, and running effects resolve as "preempted".

**Always feature-detect**
- `if (gp.vibrationActuator?.playEffect) ...`, and catch rejections.

## (B) Supabase Realtime JS v2

### B1. API

**Channel options**
- `supabase.channel(name, { config: { broadcast: { self?, ack?, replay? }, presence: { key?, enabled? }, private? } })`
- The name `'realtime'` is reserved.
- Broadcast `self` defaults to false (you don't receive your own messages).
- With `ack` false, `send()` resolves immediately. With `ack: true` it waits for the server.
- Without `presence.key`, the server generates a UUIDv1 key.

**Listening**
- `.on('broadcast', { event: 'name' | '*' }, (payload) => ...)`
- `.on('presence', { event: 'sync' }, () => ch.presenceState())`
  - `presenceState()` returns `{ [key]: [payload, ...] }`.
- `.on('presence', { event: 'join' }, ({ key, newPresences }) => ...)`
- `.on('presence', { event: 'leave' }, ({ key, leftPresences }) => ...)`
- `sync` can fire with no real join or leave (state reconciliation).

**Subscribe states**
- `.subscribe((status, err) => ...)`, where status is one of `SUBSCRIBED`, `TIMED_OUT`, `CLOSED`, `CHANNEL_ERROR`.

**Sending and presence**

| Call | Returns |
|---|---|
| `send({ type: 'broadcast', event, payload })` | `'ok' \| 'timed out' \| 'error'` |
| `track(obj)` | the same response type (call it after `SUBSCRIBED`) |
| `untrack()` | the same response type |
| `httpSend(event, payload, { timeout? })` | resolves `{ success: true }` on HTTP 202 |

- If the socket can't push yet, `send()` falls back to REST and logs "Realtime send() is automatically falling back to REST API. This behavior will be deprecated in the future."
- `httpSend` requires supabase-js ≥ 2.107.0 and Realtime server ≥ 2.97.0. It always uses REST, needs no subscription, and rejects (never resolves `success: false`) on errors. A null payload throws.
- Binary payloads need supabase-js ≥ 2.91.0; older versions drop them silently.

**Client options**
- `RealtimeClient` supports `worker: true` (heartbeat in a Web Worker) and `heartbeatIntervalMs` (default 25000). Use the worker option against hidden-tab timer throttling.

**Sources**
- https://supabase.com/docs/guides/realtime/broadcast
- https://supabase.com/docs/guides/realtime/presence
- https://raw.githubusercontent.com/supabase/supabase-js/master/packages/core/realtime-js/src/RealtimeChannel.ts
- https://raw.githubusercontent.com/supabase/supabase-js/master/packages/core/realtime-js/src/RealtimeClient.ts

### B2. Free-plan limits

**Per-project limits** (https://supabase.com/docs/guides/realtime/limits)

| Limit | Free | Pro |
|---|---|---|
| Concurrent connections | 200 | 500 |
| Messages per second (project-wide) | 100 | 500 |
| Channel joins per second | 100 | 500 |
| Presence messages per second | 20 | 50 |
| Broadcast payload size | 256 KB | 3,000 KB |

- Every plan:
  - Channels per connection: 100
  - Presence keys per object: 10
  - Presence calls per client: 5 per 30 seconds
  - Postgres-changes payload: 1,024 KB
- Over-limit errors: `too_many_connections`, `too_many_channels`, `too_many_joins`, `tenant_events`. The last one disconnects clients, and supabase-js reconnects automatically.
- An "event" is "a WebSocket message delivered to, or sent from a client". So the per-second limit very likely counts both sent and received messages.

**Monthly quota** (https://supabase.com/pricing)
- Free: 2 million messages a month and 200 peak connections.
- Pro and Team: 5 million included, then $2.50 per million; extra connections $10 per 1,000.
- Free projects pause after 1 week of inactivity.

**How messages are counted** (https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)
- One broadcast counts as 1 sent plus 1 per receiving client. With 6 players that is 6 messages per broadcast.

**Implication [inferred]: Broadcast can't carry live game state on the free plan**
- At 15 Hz with 6 players: 6 × 15 × 6 = 540 messages a second, which is over the 100/s limit.
- Even at 10 Hz the 2-million monthly quota lasts about 1.5 hours of play in total.
- Use Supabase only for the lobby, presence, matchmaking, text chat and WebRTC signaling. Send game state and voice over WebRTC.

### B3. Public access without auth

- In Realtime Settings, "Allow public access to channels" defaults to **Enabled**: "Anyone with your project's anon key can subscribe to and broadcast on any public channel."
- If it is disabled, joins are checked against RLS on `realtime.messages`, and clients without `config.private: true` are rejected with "PrivateOnly".
- Changing any setting there disconnects every client.
- Source: https://supabase.com/docs/guides/realtime/settings
- Public Realtime connections last at most 24 hours unless upgraded to user-level authentication: https://supabase.com/docs/guides/api/api-keys
- Publishable keys are not JWTs: send them as `apikey`, not `Bearer`. The docs don't say explicitly that publishable keys equal anon keys for Realtime **[inferred: they should work as the client key]**.

## (C) WebRTC for browser games

### C1. Perfect negotiation (MDN)

Source: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation

**State**
- `makingOffer = false`, `ignoreOffer = false`, `isSettingRemoteAnswerPending = false`, plus `polite` (for example, the peer that joined first).

**Negotiation handler**
```js
pc.onnegotiationneeded = async () => {
  try { makingOffer = true; await pc.setLocalDescription(); signaler.send({ description: pc.localDescription }); }
  catch (e) { console.error(e) } finally { makingOffer = false }
};
pc.onicecandidate = ({ candidate }) => signaler.send({ candidate });
```

**Message handler**
- On a description:
  - `readyForOffer = !makingOffer && (pc.signalingState === "stable" || isSettingRemoteAnswerPending)`
  - `offerCollision = description.type === "offer" && !readyForOffer`
  - `ignoreOffer = !polite && offerCollision`; if true, return.
  - Set `isSettingRemoteAnswerPending = description.type === "answer"`, call `await pc.setRemoteDescription(description)`, then set it back to false.
  - If it was an offer: `await pc.setLocalDescription()` and send `pc.localDescription`.
- On a candidate: `try { await pc.addIceCandidate(candidate) } catch (e) { if (!ignoreOffer) throw e }`.

**ICE restart**
```js
pc.oniceconnectionstatechange = () => {
  if (pc.iceConnectionState === "failed") pc.restartIce();
};
```
- `restartIce()` fires `negotiationneeded`, and the next offer automatically carries an ICE restart: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce

### C2. Unreliable, unordered data channel

```js
pc.createDataChannel("state", { ordered: false, maxRetransmits: 0 })
```

- `ordered` defaults to true. `maxRetransmits` and `maxPacketLifeTime` default to null.
- Setting both throws a `SyntaxError`.
- With `negotiated: true, id: N`, both sides create the channel with the same id and skip in-band negotiation.
- Use a second channel with default (reliable, ordered) settings for events and chat.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel

### C3. Adding audio to an existing connection

- `pc.addTrack(micTrack, stream)` "triggers renegotiation by firing a negotiationneeded event". Perfect negotiation handles that offer.
- `addTrack` reuses an unused transceiver of the same kind: recvonly becomes sendrecv, inactive becomes sendonly.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addTrack
- For push-to-talk or mute, use `sender.replaceTrack(null | track)` or `track.enabled = false`; neither renegotiates **[general knowledge; not on that MDN page]**.
- A common pattern is to call `addTransceiver('audio', { direction: 'sendrecv' })` up front so voice can be toggled later without renegotiation.

### C4. STUN and TURN

**Free STUN**
- `stun:stun.l.google.com:19302` (also stun1 to stun4) — widely used, no official SLA.
- `stun:stun.cloudflare.com:3478`.

**Cloudflare TURN**
- Pricing: "The first 1,000 GB each month is free", and "SFU and TURN share this allowance". After that $0.05 per GB.
  - Source: https://developers.cloudflare.com/realtime/sfu/pricing/
  - The TURN page itself says it is free only when used with the SFU, so the two pages read inconsistently: https://developers.cloudflare.com/realtime/turn/
- Ports: `turn.cloudflare.com` on 3478 udp/tcp, 443 udp, 80 tcp, and TLS on 5349 or 443.
- Credentials: `POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers` with Bearer token and body `{ "ttl": 86400 }`. Returns `iceServers`.
- The token must stay on the server, so you need a small backend such as a Supabase Edge Function.
- Port 53 URLs are blocked by browsers; filter them out.
- Source: https://developers.cloudflare.com/realtime/turn/generate-credentials/

**Metered Open Relay**
- Not discontinued. The page (© 2026) says "20 GB of free TURN Usage every month".
- It now requires a free signup and API key; credentials come from `https://<app>.metered.live/api/v1/turn/credentials?apiKey=...`.
- Ports 80 and 443, TCP, UDP and TLS.
- The old static `openrelayproject` username and password are not mentioned any more. Only a static-auth secret for Nextcloud-style setups remains.
- Source: https://www.metered.ca/tools/openrelay/

**Metered paid TURN**
- The "free trial" is only 500 MB a month: https://www.metered.ca/stun-turn
- free-for-dev removed Metered after that cut: https://git.hackliberty.org/Git-Mirrors/free-for-dev/commit/045db16804af849a53c29aed7fdc78c2c7ba24a8

**How often TURN is needed (vendor estimates only, no primary data)**
- About 20% of sessions need TURN; estimates range from 10% to 25%.
- Symmetric NAT and carrier-grade NAT (mobile 4G/5G, some ISPs) often fail with STUN only.
- Sources:
  - https://getstream.io/resources/projects/webrtc/advanced/stun-turn/
  - https://www.metered.ca/blog/what-is-a-turn-server/
  - https://bloggeek.me/webrtcglossary/turn/
- With 6 players in a mesh (15 pairs), at least one failing pair per room is likely without TURN **[inferred]**.

### C5. Safari and iOS caveats

**getUserMedia**
- Needs HTTPS, and the chain of frames up to the main frame must be the same secure origin.
- Only one tab captures at a time.
- A second `getUserMedia` call for the same media type mutes the earlier track, and it can't be unmuted programmatically. Capture once and use `clone()` instead.
- Sources: https://webkit.org/blog/7763/a-closer-look-into-webrtc/ and https://webrtchacks.com/guide-to-safari-webrtc/

**Autoplay of remote audio**
- MediaStream-backed media autoplays only "if the web page is already capturing" or already playing audio. Otherwise a user gesture is needed to start audio playback.
- Use `<audio autoplay playsinline>` and call `.play()` from a click such as a "Join voice" button.
- Resume any AudioContext inside a gesture.

**Other**
- No `setSinkId()` in WebKit.
- iOS limits several audio elements playing at once (from a reader comment on webrtchacks).
- iOS does not include local ICE candidates by default.

**Volume and routing while the mic is open [user-reported workarounds]**
- With the mic open, iOS switches to play-and-record. Remote and game audio can drop in volume or route to the earpiece.
- Reported workaround: switch `navigator.audioSession.type` between `'auto'` and `'play-and-record'` around `getUserMedia`. User-reported only, no Apple fix confirmed.
- Sources:
  - https://bugs.webkit.org/show_bug.cgi?id=282939
  - https://bugs.webkit.org/show_bug.cgi?id=262759
  - https://bugs.webkit.org/show_bug.cgi?id=218012