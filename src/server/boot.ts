/**
 * Το πρώτο που φορτώνει ο server (main.ts): η μετονομασία των φακέλων SkakiBase → KnightBase γίνεται πριν
 * από το paths.ts, που διαλέγει τους φακέλους μία φορά, στη φόρτωσή του.
 */
import { migrateFromSkakiBase } from './rename.ts';

migrateFromSkakiBase(Number(process.env.KNIGHTBASE_PORT ?? 4747));
