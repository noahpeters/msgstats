import 'dotenv/config';
import { initDatabase } from '../db';

const databasePath = process.env.DATABASE_PATH ?? './data/msgstats.sqlite';
initDatabase(databasePath);
console.log('Migrations applied.');
