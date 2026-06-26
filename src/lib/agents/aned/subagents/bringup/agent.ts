import { defineSubagent } from '../../../runtime/define';
import { instructions } from './instructions';

export default defineSubagent({
  description:
    'Delegate getting the app installed and running (or diagnosing why it will not). Use for connected repos that are not yet serving, or after a crash. Pass a self-contained message including the dev port to bind.',
  instructions,
});
