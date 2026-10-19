/**
 * «Ночь клыков», Серия 5 «Чёрный перевал» (episode `fangs4`, level `fangs4_pass`): the mountain road to Замок
 * Полночь — collapsing rope bridges, wind gusts on a ridge, a cliff climb, a bat swarm down a ravine, the ruins of the
 * old world with grey goats and an ambush, and the twin sisters Ночка / Тенька at the Солнечный камень; then the
 * third ingredient, the Солнечный сироп and Ноки's confession at the campfire (docs/script-fangs.md §8).
 * Imported once from arc/index.ts.
 */
import { wait } from '../../../../game/coroutine';
import { audio } from '../../../../engine/audio';
import type { Level3D } from '../../level';
import { addLevels, addScripts } from '../registry';
import { fangs4Pass, f4 } from './level';
import { FANGS4_SCRIPTS, bridgeBarks, swarmBarks, setExit } from './scripts';
import { cast } from './cast';
import { LINES4 } from './lines';

addLevels({ fangs4_pass: fangs4Pass });
addScripts(FANGS4_SCRIPTS, {
  // every build (respawns, co-op team restarts too), on every machine, after the level's build
  fangs4_pass(L: Level3D) {
    const r = f4(L);
    cast(L);
    // (the confession plays the music quieter: never leave it ducked, whatever ends the level)
    L.plugins.push({ dispose: () => audio.duckMusic(1) });
    r.bridges[0].onCollapse = (L2) => bridgeBarks(L2);
    // a straggler waiting at the near end: the bridge is back
    r.bridges[0].onWhole = (L2) => { const p = L2.player.pos, b = r.bridges[0]; if (L2.player.dead) return; if (Math.abs(p.x - b.cx) < 14 && p.z > b.zA - 1 && p.z < b.zA + 14) L2.toast(LINES4.bridgeBack); };
    r.swarm.onStart = (L2) => swarmBarks(L2);
    // the host decides the knockout; L.run plays the defeat for everyone
    r.twins.onDefeat = () => {
      if (!L.authority) return;
      L.runGen((function* () { yield wait(1.4); L.run('fangs4_boss_defeat'); })());
    };
    if (L.seen.has('f4won')) {
      // already won (a later respawn): the stone glows, the fire burns, the way out is open
      r.twins.vanishAll();
      r.stoneK = 1;
      r.fire.set(true);
      setExit(L);
    } else if (L.seen.has('fangs4_boss_intro')) {
      // a retry of the fight (solo respawn / co-op team restart): the twins greet the team again (§12)
      L.seen.delete('fangs4_boss_retry');
      L.trigger(-5, 18, -381.5, 5, 26, -379.2, 'fangs4_boss_retry');
    }
  },
});

export { f4 };
