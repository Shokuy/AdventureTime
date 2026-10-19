/** Tiny coroutine system for cutscenes and scripted sequences. */
export interface Waiter { update(dt: number): boolean }
export type Script = Generator<Waiter | undefined, void, unknown>;

export const wait = (sec: number): Waiter => {
  let t = 0;
  return { update(dt) { t += dt; return t >= sec; } };
};

export const until = (cond: () => boolean): Waiter => ({ update: () => cond() });

/** run several waiters in parallel; done when all are done */
export const all = (...ws: Waiter[]): Waiter => {
  const done = ws.map(() => false);
  return {
    update(dt) {
      let ok = true;
      ws.forEach((w, i) => { if (!done[i]) { done[i] = w.update(dt); if (!done[i]) ok = false; } });
      return ok;
    },
  };
};

/** tween a value over time */
export const tween = (d: number, fn: (k: number) => void, easeFn: (t: number) => number = (t) => t): Waiter => {
  let t = 0;
  fn(0);
  return {
    update(dt) {
      t += dt;
      const k = Math.min(1, t / d);
      fn(easeFn(k));
      return k >= 1;
    },
  };
};

/** wrap a sub-script as a waiter */
export const sub = (script: Script): Waiter => {
  const co = new Coroutine(script);
  return { update(dt) { co.update(dt); return co.done; } };
};

export class Coroutine {
  done = false;
  private cur: Waiter | undefined;
  constructor(private gen: Script) {}
  /** end it now: the script's `finally` blocks still run (scene props put away, figures dropped, a fight started…) */
  stop() {
    if (this.done) return;
    this.done = true;
    this.cur = undefined;
    try { this.gen.return(undefined); } catch (e) { console.error('[coroutine] stop: cleanup failed', e); }
  }
  update(dt: number) {
    if (this.done) return;
    let guard = 0;
    for (;;) {
      if (this.cur && !this.cur.update(dt)) return;
      dt = 0;
      const r = this.gen.next();
      if (r.done) { this.done = true; return; }
      this.cur = r.value;
      if (++guard > 500) return;
    }
  }
}
