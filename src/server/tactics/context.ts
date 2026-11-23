/** Κοινή κατάσταση της Τακτικής: φάκελος δεδομένων (<βάσεις>/Τακτική), οι δύο βάσεις, η ουρά εργασιών και οι κρυφές μνήμες. */
import fs from 'node:fs';
import path from 'node:path';
import { JobQueue } from './jobs.ts';
import { PuzzleDb, UserDb } from './store.ts';

export const TACTICS_FOLDER = 'Τακτική';

export class Tactics {
  readonly dir: string;
  readonly downloadsDir: string;
  readonly jobs = new JobQueue();
  private _puzzles: PuzzleDb | null = null;
  private _user: UserDb | null = null;
  /** αυξάνεται σε κάθε αλλαγή των puzzles (ακυρώνει τις κρυφές μνήμες επιλογής) */
  generation = 0;
  private listeners: Array<() => void> = [];

  constructor(databasesDir: string) {
    this.dir = path.join(databasesDir, TACTICS_FOLDER);
    this.downloadsDir = path.join(this.dir, 'downloads');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  get puzzles(): PuzzleDb {
    if (!this._puzzles) this._puzzles = new PuzzleDb(path.join(this.dir, 'puzzles.sqlite'));
    return this._puzzles;
  }

  get user(): UserDb {
    if (!this._user) this._user = new UserDb(path.join(this.dir, 'tactics-user.sqlite'));
    return this._user;
  }

  /** Μετά από εισαγωγή: οι κρυφές μνήμες (λίστες θεμάτων, μετρήσεις) ξαναφτιάχνονται. */
  puzzlesChanged(): void {
    this.generation++;
    for (const f of this.listeners) f();
  }

  onPuzzlesChanged(f: () => void): void {
    this.listeners.push(f);
  }

  close(): void {
    this._puzzles?.close();
    this._user?.close();
    this._puzzles = null;
    this._user = null;
  }
}
