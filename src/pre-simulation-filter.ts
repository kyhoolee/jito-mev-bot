import {
  AddressLookupTableAccount,
  MessageAccountKeys,
  VersionedTransaction,
} from '@solana/web3.js';
import { dropBeyondHighWaterMark } from './utils.js';
import { logger } from './logger.js';
import { isTokenAccountOfInterest } from './markets/index.js';
import { MempoolUpdate } from './mempool.js';
import { Timings } from './types.js';
import { lookupTableProvider } from './lookup-table-provider.js';

// This array contains addresses to skip when processing transactions.
// For example, 'orca whirlpool' is excluded because its transactions interfere with
// downstream calculations, making them unsuitable for backrunning strategies.
const SKIP_TX_IF_CONTAINS_ADDRESS = [
  '882DFRCi5akKFyYxT4PP2vZkoQEGvm2Nsind2nPDuGqu', // Rebalancing transactions of orca whirlpool mm
];

// Set a high water mark to limit the number of mempool updates processed at a time.
const HIGH_WATER_MARK = 250;

// Define the structure for a filtered transaction which includes:
// - The transaction itself (`txn`)
// - A list of token accounts of interest involved in the transaction (`accountsOfInterest`)
// - Timings to track the lifecycle of the transaction processing (`timings`)
type FilteredTransaction = {
  txn: VersionedTransaction;
  accountsOfInterest: string[];
  timings: Timings;
};

// This is an async generator function that filters mempool transactions before they are simulated.
async function* preSimulationFilter(
  mempoolUpdates: AsyncGenerator<MempoolUpdate>, // An async stream of mempool updates
): AsyncGenerator<FilteredTransaction> {
  
  // Limit the number of mempool updates processed based on the HIGH_WATER_MARK to avoid overload.
  // This is done using the `dropBeyondHighWaterMark()` utility function, which discards excess updates.
  const mempoolUpdatesGreedy = dropBeyondHighWaterMark(
    mempoolUpdates,
    HIGH_WATER_MARK,
    'mempoolUpdates', // Debug label for logging
  );

  // Iterate over the mempool updates (each containing transactions and timings)
  for await (const { txns, timings } of mempoolUpdatesGreedy) {
    // Process each transaction (`txn`) in the update
    for (const txn of txns) {
      
      // Fetch the address lookup table accounts associated with this transaction.
      // Address lookup tables are used to manage large account key sets in Solana transactions.
      const addressLookupTableAccounts: AddressLookupTableAccount[] = [];
      
      // For each lookup table entry in the transaction, get the associated accounts from the lookup table provider.
      for (const lookup of txn.message.addressTableLookups) {
        const lut = await lookupTableProvider.getLookupTable(lookup.accountKey);
        if (lut === null) {
          // If any lookup table is missing, stop processing this transaction.
          break;
        }
        addressLookupTableAccounts.push(lut);
      }

      // Extract the full set of account keys for the transaction using the address lookup tables.
      let accountKeys: MessageAccountKeys | null = null;
      try {
        accountKeys = txn.message.getAccountKeys({
          addressLookupTableAccounts,
        });
      } catch (e) {
        // If there's an error, log a warning but continue with the next transaction.
        logger.warn(e, 'address not in lookup table');
      }

      // Use a Set to track all accounts of interest in this transaction.
      const accountsOfInterest = new Set<string>();

      // Flag to indicate if the transaction should be skipped.
      let skipTx = false;
      
      // Loop through all account keys in the transaction and check if any are in the skip list.
      for (const key of accountKeys.keySegments().flat()) {
        const keyStr = key.toBase58(); // Convert key to a base58 string

        // If the transaction contains any address in the `SKIP_TX_IF_CONTAINS_ADDRESS` list, skip this transaction.
        if (SKIP_TX_IF_CONTAINS_ADDRESS.includes(keyStr)) {
          skipTx = true;
          break;
        }

        // Check if the account is a token account of interest (using a market-specific function).
        if (isTokenAccountOfInterest(keyStr)) {
          accountsOfInterest.add(keyStr); // Add the token account to the set of interesting accounts.
        }
      }

      // Skip the transaction if it matched any address in the skip list.
      if (skipTx) continue;
      // Also skip if no accounts of interest were found in the transaction.
      if (accountsOfInterest.size === 0) continue;

      // Log that a transaction with accounts of interest was found.
      logger.debug(
        `Found txn with ${accountsOfInterest.size} accounts of interest`,
      );

      // Yield the filtered transaction, which includes the transaction itself,
      // the list of accounts of interest, and timings for tracking.
      yield {
        txn,
        accountsOfInterest: [...accountsOfInterest], // Convert the Set to an array
        timings: {
          mempoolEnd: timings.mempoolEnd, // Time when the transaction entered the mempool
          preSimEnd: Date.now(), // Capture the end time for the pre-simulation phase
          simEnd: 0,
          postSimEnd: 0,
          calcArbEnd: 0,
          buildBundleEnd: 0,
          bundleSent: 0,
        },
      };
    }
  }
}

export { FilteredTransaction, preSimulationFilter };
