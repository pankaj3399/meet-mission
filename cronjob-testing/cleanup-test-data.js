// cleanup-test-data.js

require("dotenv").config();
const mongoose = require("mongoose")
const mongo = require('../model/mongo/mongo');

// Import your models
const Location = require("../model/location");
const EventManagement = require("../model/event-management");
const registeredParticipant = require('../model/registered-participant');
const account = require('../model/account');
const user = require('../model/user');
const transaction = require('../model/transaction');

/**
 * =================================================================================
 * CLEANUP SCRIPT LOGIC
 * =================================================================================
 * This script deletes ONLY the test data created by populate-data.js
 * It uses specific markers to identify test data:
 * - Accounts with name: "Tested for cronjob."
 * - RegisteredParticipants with is_test: true
 * - Transactions linked to test participants
 * - Events with tagline containing "Test Event"
 * - Users linked to test accounts
 */

async function cleanupTestData() {
  console.log("--- Starting Test Data Cleanup ---");

  let deletionStats = {
    transactions: 0,
    registeredParticipants: 0,
    users: 0,
    accounts: 0,
    events: 0,
    locations: 0
  };

  try {
    // Step 1: Find all test accounts (created by populate-data.js)
    console.log("Step 1: Finding test accounts...");
    const testAccounts = await account.schema.find({
      name: "Tested for cronjob."
    });

    const testAccountIds = testAccounts.map(acc => acc.id);
    console.log(`-> Found ${testAccountIds.length} test accounts`);

    if (testAccountIds.length === 0) {
      console.log("No test data found. Exiting cleanup.");
      return deletionStats;
    }

    // Step 2: Find all test registered participants
    console.log("Step 2: Finding test registered participants...");
    const testParticipants = await registeredParticipant.schema.find({
      is_test: true
    });

    const testParticipantIds = testParticipants.map(p => p._id);
    const testEventIds = [...new Set(testParticipants.map(p => p.event_id))];
    const testUserIds = [...new Set(testParticipants.map(p => p.user_id))];

    console.log(`-> Found ${testParticipantIds.length} test participants`);
    console.log(`-> Found ${testEventIds.length} test events`);
    console.log(`-> Found ${testUserIds.length} test users`);

    // Step 3: Delete transactions linked to test participants
    console.log("Step 3: Deleting test transactions...");
    const transactionDeleteResult = await transaction.schema.deleteMany({
      $or: [
        { participant_id: { $in: testParticipantIds } },
        { sub_participant_id: { $in: testParticipantIds } },
        { user_id: { $in: testUserIds } }
      ]
    });
    deletionStats.transactions = transactionDeleteResult.deletedCount;
    console.log(`-> Deleted ${deletionStats.transactions} transactions`);

    // Step 4: Delete registered participants
    console.log("Step 4: Deleting test registered participants...");
    const participantDeleteResult = await registeredParticipant.schema.deleteMany({
      is_test: true
    });
    deletionStats.registeredParticipants = participantDeleteResult.deletedCount;
    console.log(`-> Deleted ${deletionStats.registeredParticipants} registered participants`);

    // Step 5: Delete users linked to test accounts
    console.log("Step 5: Deleting test users...");
    const userDeleteResult = await user.schema.deleteMany({
      default_account: { $in: testAccountIds }
    });
    deletionStats.users = userDeleteResult.deletedCount;
    console.log(`-> Deleted ${deletionStats.users} users`);

    // Step 6: Delete test accounts
    console.log("Step 6: Deleting test accounts...");
    const accountDeleteResult = await account.schema.deleteMany({
      name: "Tested for cronjob."
    });
    deletionStats.accounts = accountDeleteResult.deletedCount;
    console.log(`-> Deleted ${deletionStats.accounts} accounts`);

    // Step 7: Delete test events
    console.log("Step 7: Deleting test events...");
    const eventDeleteResult = await EventManagement.schema.deleteMany({
      $or: [
        { _id: { $in: testEventIds } },
        { tagline: { $regex: /Test Event.*for Cron Job/i } }
      ]
    });
    deletionStats.events = eventDeleteResult.deletedCount;
    console.log(`-> Deleted ${deletionStats.events} events`);

    // Step 8: Delete test locations (bars)
    // Note: This is trickier since bars don't have a direct test marker
    // We'll delete bars that are ONLY referenced by test events
    console.log("Step 8: Finding and deleting test locations...");

    // First, find all bars referenced by test events
    const testEvents = await EventManagement.schema.find({
      _id: { $in: testEventIds }
    }).select('bars');

    const testBarIds = [];
    testEvents.forEach(event => {
      if (event.bars && Array.isArray(event.bars)) {
        event.bars.forEach(barRef => {
          if (barRef.bar) {
            testBarIds.push(barRef.bar);
          }
        });
      }
    });

    // Check if these bars are referenced by any non-test events
    const nonTestEvents = await EventManagement.schema.find({
      _id: { $nin: testEventIds },
      'bars.bar': { $in: testBarIds }
    }).select('bars');

    const barsInNonTestEvents = new Set();
    nonTestEvents.forEach(event => {
      if (event.bars && Array.isArray(event.bars)) {
        event.bars.forEach(barRef => {
          if (barRef.bar) {
            barsInNonTestEvents.add(barRef.bar.toString());
          }
        });
      }
    });

    // Only delete bars that are NOT in non-test events
    const barIdsToDelete = testBarIds.filter(
      barId => !barsInNonTestEvents.has(barId.toString())
    );

    if (barIdsToDelete.length > 0) {
      const locationDeleteResult = await Location.schema.deleteMany({
        _id: { $in: barIdsToDelete }
      });
      deletionStats.locations = locationDeleteResult.deletedCount;
      console.log(`-> Deleted ${deletionStats.locations} locations (bars)`);
    } else {
      console.log("-> No locations to delete (all bars are used by other events)");
    }

    console.log("\n--- Test Data Cleanup Complete ---");
    console.log("Deletion Summary:");
    console.log(`  - Transactions: ${deletionStats.transactions}`);
    console.log(`  - Registered Participants: ${deletionStats.registeredParticipants}`);
    console.log(`  - Users: ${deletionStats.users}`);
    console.log(`  - Accounts: ${deletionStats.accounts}`);
    console.log(`  - Events: ${deletionStats.events}`);
    console.log(`  - Locations: ${deletionStats.locations}`);
    console.log("---------------------------------------");

    return deletionStats;

  } catch (error) {
    console.error("Error during cleanup:", error);
    throw error;
  }
}

/**
 * =================================================================================
 * SCRIPT EXECUTION
 * =================================================================================
 */

if (require.main === module) {
  (async () => {
    try {
      await mongo.connect();
      console.log("MongoDB connected successfully.");

      // Confirm before deletion
      console.log("\n⚠️  WARNING: This will delete test data from the database!");
      console.log("Test data is identified by:");
      console.log("  - Accounts with name: 'Tested for cronjob.'");
      console.log("  - Participants with is_test: true");
      console.log("  - Related transactions, users, events, and locations\n");

      // Run cleanup
      await cleanupTestData();

    } catch (error) {
      console.error("An error occurred during cleanup:", error);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
      console.log("MongoDB connection closed.");
      process.exit(0);
    }
  })();
}

// Export the function for use in other scripts
module.exports = { cleanupTestData };
