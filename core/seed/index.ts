/**
 * The seed actions over one seed set (HIVE-162, HIVE-441). Since HIVE-448 the app ships no agents and no skills, so
 * every set is an installed swarm's: `core/swarms` answers them.
 */
export { keepMine, resetShipped, shippedStatus, takeShippedPrompt } from './actions';
