import { defineSubagent } from '../../../runtime/define';
import { instructions } from './instructions';

export default defineSubagent({
  description:
    'Delegate establishing or extending the project design system and its living /design-system route. Use BEFORE building product pages when no design system exists. Pass the confirmed design preferences.',
  instructions,
});
