/**
 * Tool slot barrel — name = filename (the Eve path-naming rule, made explicit
 * for Next's bundler). Drop a new tool file in this dir, add one line here.
 *
 * `READONLY` lists the non-mutating tools plan mode may use.
 */

import type { ToolDef } from '../../runtime/define';

import ask_user from './ask_user';
import check_console from './check_console';
import grep from './grep';
import list_dir from './list_dir';
import read_file from './read_file';
import run_cmd from './run_cmd';
import start_app from './start_app';
import str_replace from './str_replace';
import web_fetch from './web_fetch';
import write_file from './write_file';

export const tools: Record<string, ToolDef> = {
  read_file,
  write_file,
  str_replace,
  list_dir,
  grep,
  run_cmd,
  web_fetch,
  ask_user,
  start_app,
  check_console,
};

/** Read-only subset exposed in plan mode (observe-only tools). */
export const READONLY = [
  'read_file',
  'list_dir',
  'grep',
  'web_fetch',
  'ask_user',
  'check_console',
];
