#!/usr/bin/env node
// Guards the one thing the vitest suite (rulesFile.test.ts) does not: that
// rules.schema.json — the file `contributes.jsonValidation` points editors at, shipped as its own
// file in the .vsix — is on its own a syntactically valid, self-contained JSON Schema. vitest already
// proves its *behavior* against fixtures; this catches a typo that breaks compilation outright (a bad
// $ref, a duplicate $id, strict-mode violations) even in a change that never touches a test file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const schemaPath = fileURLToPath(new URL('rules.schema.json', import.meta.url));

// This is a CLI script — console is its only interface with the caller (same rationale as
// tools/**'s no-console exemption, which this file is not covered by since it lives outside tools/).
/* eslint-disable no-console */

function main() {
  const raw = readFileSync(schemaPath, 'utf8');
  let schema;
  try {
    schema = JSON.parse(raw);
  } catch (error) {
    console.error(`${schemaPath} is not valid JSON:`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const ajv = new Ajv({ allErrors: true, strict: true });
  try {
    ajv.compile(schema);
  } catch (error) {
    console.error(`${schemaPath} does not compile as a JSON Schema:`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log(`OK: ${schemaPath} compiles as a self-contained JSON Schema.`);
}

main();
