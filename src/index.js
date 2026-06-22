#!/usr/bin/env node

import 'dotenv/config';
import { parseCli } from './cli.js';
import { setContext } from './context.js';
import { main } from './main.js';

export { updateMeetingKnowledge } from './meeting-knowledge.js';

const options = parseCli();
setContext(process.cwd(), options);

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
