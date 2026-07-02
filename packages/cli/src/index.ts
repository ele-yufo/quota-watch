#!/usr/bin/env node

import { Command } from 'commander';
import { statusCommand } from './commands/status.js';
import { registerConfigCommand } from './commands/config.js';
import { dashboardCommand } from './commands/dashboard.js';
import { registerDaemonCommand } from './commands/daemon.js';
import { registerConnectCommand } from './commands/connect.js';

const program = new Command();

program
  .name('quota-watch')
  .version('0.1.0')
  .description('AI Quota Monitor — track usage across providers');

// Register commands
statusCommand(program);
registerConfigCommand(program);
dashboardCommand(program);
registerDaemonCommand(program);
registerConnectCommand(program);

program.parse();
