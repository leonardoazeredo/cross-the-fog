// The tiles a running download is asking for. A later run that needs one waits on the entry instead of asking
// again. A run's claims end with its own call to the street source, which never waits for another run, so two
// runs never wait on each other.
import { type Tile, tileId } from "./streetGrid.ts";

// What the street source said of a tile it read ({cached: true} from the street cache); nothing when the run gave
// the tile up.
export type Via = { cached?: boolean };

// The entry for one tile in flight: `promise` settles once the run bringing it read it or gave it up.
export interface Entry {
  promise: Promise<Via | undefined>;
  done(via?: Via): void;
}

// One run's claims, so releasing a tile never touches an entry another run set up for it.
export interface RunClaims {
  // from now on this run is bringing these tiles
  claim(tiles: Tile[]): void;
  // the tile was read (`via` is what the source said of it) or given up (no `via`); settles the entry once, a
  // second release or one for a tile this run does not hold does nothing
  release(id: string, via?: Via): void;
}

export interface InFlight {
  // the entry a running download has for this tile, if any
  of(id: string): Entry | undefined;
  // whether no tile is in flight: every run's claims are given back when it ends
  idle(): boolean;
  // a run's own view
  forRun(): RunClaims;
}

export function createInFlight(): InFlight {
  const entries = new Map<string, Entry>();
  return {
    of: (id) => entries.get(id),
    idle: () => entries.size === 0,
    forRun() {
      const mine = new Map<string, Entry>();
      return {
        claim(tiles) {
          for (const t of tiles) {
            const id = tileId(t);
            let done!: (via?: Via) => void;
            const promise = new Promise<Via | undefined>((resolve) => {
              done = resolve;
            });
            const entry = { promise, done };
            mine.set(id, entry);
            entries.set(id, entry);
          }
        },
        release(id, via) {
          const entry = mine.get(id);
          if (!entry) return;
          mine.delete(id);
          // another run may have claimed the tile since: its entry stays
          if (entries.get(id) === entry) entries.delete(id);
          entry.done(via);
        },
      };
    },
  };
}
