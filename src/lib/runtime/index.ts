/**
 * Active sandbox runtime. Daytona is the provider; everything else imports
 * `runtime` from here (never the provider module directly), so swapping
 * providers later means changing only this file + adding an adapter.
 */

import { DaytonaRuntime } from './daytona';
import type { Runtime } from './types';

export const runtime: Runtime = new DaytonaRuntime();
