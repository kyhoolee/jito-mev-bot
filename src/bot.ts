import { mempool } from './mempool.js';
import { simulate } from './simulation.js';
import { postSimulateFilter } from './post-simulation-filter.js';
import { preSimulationFilter } from './pre-simulation-filter.js';
import { calculateArb } from './calculate-arb.js';
import { buildBundle } from './build-bundle.js';
import { sendBundle } from './send-bundle.js';

// 1. Start by getting updates from the mempool.
// These are unconfirmed transactions on the blockchain.
// `mempool()` returns an async generator that streams transactions.
const mempoolUpdates = mempool();

// 2. Apply a pre-simulation filter to the mempool transactions.
// This filters out unwanted transactions, leaving only those that may be of interest.
// For example, you might filter by fee, type of transaction, or sender.
// The result is a stream of filtered transactions.
const filteredTransactions = preSimulationFilter(mempoolUpdates);

// 3. Simulate the execution of the filtered transactions to estimate their outcomes.
// This step helps predict the result of each transaction, like gas fees, slippage, or potential profit.
// The function returns a stream of simulation results.
const simulations = simulate(filteredTransactions);

// 4. Apply a post-simulation filter to narrow down the simulated transactions.
// This filter only passes transactions that are feasible and profitable for backrunning (a trading strategy).
// The result is a stream of backrunnable trades that could be executed.
const backrunnableTrades = postSimulateFilter(simulations);

// 5. Calculate arbitrage opportunities from the backrunnable trades.
// Arbitrage takes advantage of price differences between markets.
// This step identifies the trades that offer a profitable arbitrage opportunity.
const arbIdeas = calculateArb(backrunnableTrades);

// 6. Build a bundle of transactions based on the arbitrage ideas.
// A bundle may involve multiple steps in different markets to complete the arbitrage.
// The result is a stream of bundles ready to be sent to the blockchain.
const bundles = buildBundle(arbIdeas);

// 7. Send the prepared bundles to the blockchain for execution.
// The bundles are sent in order to take advantage of the arbitrage opportunities.
// This is the final step, and since it's asynchronous, we use `await` to ensure the process completes.
await sendBundle(bundles);
