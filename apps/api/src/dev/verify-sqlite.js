/**
 * Minimal verification that better-sqlite3 installs and runs correctly on this machine.
 * Uses an in-memory database only — no file is created on disk.
 * Run with: npm run verify:sqlite --workspace=apps/api
 */

// @ts-check
"use strict";

const Database = require("better-sqlite3");

const db = new Database(":memory:");

// Create a table, insert a row, read it back
db.exec(`
  CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO test (value) VALUES ('ok');
`);

const row = db.prepare("SELECT id, value FROM test WHERE id = 1").get();

if (!row || row.value !== "ok") {
  console.error("better-sqlite3 verification FAILED — unexpected row:", row);
  process.exit(1);
}

db.close();

console.log("better-sqlite3 verification PASSED");
console.log(`  Node version : ${process.version}`);
console.log(`  Platform     : ${process.platform}`);
console.log(`  Row returned : id=${row.id}, value=${row.value}`);
