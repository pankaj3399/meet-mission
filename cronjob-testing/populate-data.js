require("dotenv").config();
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const mongo = require('../model/mongo/mongo');

// --- Helper & Models ---
const {
  generateParticipantData,
  generateBarData,
} = require("./testDataGeneratorForCronJob");
// const User = require("../model/user");
const Location = require("../model/location"); // bar model
const EventManagement = require("../model/event-management");
const RegisteredParticipant = require("../model/registered-participant")
const {create: registeredParticipantCreate} = require('./meet-server-models/registered-participant')
const {create: accountCreate} = require('./meet-server-models/account')
const {create: userCreate} = require('./meet-server-models/user')
const {create: transactionCreate } = require('./meet-server-models/transaction');
const { create } = require("../model/city");

// --- Test Configuration ---
// Easily change these values to test different scenarios
const TOTAL_PARTICIPANTS = 35; // Change this to test Mode A, B, or C
const BAR_INPUTS = [
  { capacity: 20 },
  { capacity: 18 },
  { capacity: 25 },
  { capacity: 15 },
  { capacity: 30 },
];
// We need a valid ObjectId for the 'city'. For a local test, we can create a mock one.
const MOCK_CITY_ID = new mongoose.Types.ObjectId();

/**
 * =================================================================================
 * MAIN SCRIPT LOGIC
 * =================================================================================
 */

async function populateDatabase() {
  console.log("--- Starting Database Seeding ---");

  // // 3. Create Bars in the 'location' collection
  const createdBars = await seedBars(MOCK_CITY_ID);

  // // 4. Create an Event and link the created bars to it
  const createdEvent = await seedEvent("68f8fbb42e880ac8f5b22ceb", createdBars);
  if (!createdEvent) {
    console.log("event didn't created...");
    return;
  };

  const event_id = createdEvent._id.toString();

  await seedUsersAndRegisterForEvent(event_id);

  // 5. Register the created Users for the new Event
  // await registerUsersForEvent(createdUsers, event_id);

  console.log("--- Database Seeding Finished Successfully ---");
  console.log("---------------------------------------");
  console.log("---------------------------------------");
  console.log("---------------------------------------");
}

/**
 * Generates and saves user data to the database.
 */
async function seedUsersAndRegisterForEvent(eventId) {
  console.log(`Step 2: Generating and seeding ${TOTAL_PARTICIPANTS} users...`);
  const users = generateParticipantData(TOTAL_PARTICIPANTS);
  const createdUser = [];

  await Promise.all(users.map(async (usr) => {
      // --- MAIN USER ---
      // console.log("user: ", usr);
      const saveAccount = await accountCreate();
      // console.log("saveAccount id: ", typeof saveAccount.id);
      const saveUser = await userCreate({
        user: {
          account: [
            {
              id: saveAccount.id,
              permission: "owner",
              onboarded: true,
            },
          ],
          name: usr.name,
          email: usr.email,
          avatar: null,
          verified: true,
          is_invited: false,
          gender: usr.gender,
          date_of_birth: usr.date_of_birth,
          looking_for: usr.looking_for,
          relationship_goal: usr.relationship_goal,
          children: usr.children,
          kind_of_person: usr.kind_of_person,
          feel_around_new_people: usr.feel_around_new_people,
          prefer_spending_time: usr.prefer_spending_time,
          describe_you_better: usr.describe_you_better,
          describe_role_in_relationship: usr.describe_role_in_relationship,
          password: "Password@?",
          step: 3,
          onboarded: true,
          age: usr.age,
          first_name: usr.first_name,
          last_name: usr.last_name,
        },
        default_account: saveAccount.id,
      });

      createdUser.push(saveUser);

      if (saveUser) {
        const saveEventRegistration = await registeredParticipantCreate({
          user_id: new mongoose.Types.ObjectId(saveUser._id),
          event_id: new mongoose.Types.ObjectId(eventId),
          first_name: usr.first_name,
          last_name: usr.last_name,
          gender: usr.gender,
          date_of_birth: usr.date_of_birth,
          email: usr.email,
          status: "registered",
          is_main_user: true,
          looking_for: usr.looking_for,
          relationship_goal: usr.relationship_goal,
          children: usr.children,
          kind_of_person: usr.kind_of_person,
          feel_around_new_people: usr.feel_around_new_people,
          prefer_spending_time: usr.prefer_spending_time,
          describe_you_better: usr.describe_you_better,
          describe_role_in_relationship: usr.describe_role_in_relationship,
          is_test: true,
          age_group: usr.age_group
        });

        if (saveEventRegistration) {
          let subParticipantId = null;
          let invitedUserId = null;

          // --- SUB USER (if exists) ---
          if (usr.sub_user) {
            const subUsr = usr.sub_user;

            const subAccount = await accountCreate();
            const saveSubUser = await userCreate({
              user: {
                account: [
                  {
                    id: subAccount.id,
                    permission: "owner",
                    onboarded: true,
                  },
                ],
                name: subUsr.name,
                email: subUsr.email,
                avatar: null,
                verified: true,
                is_invited: true, // invited since linked to main
                gender: subUsr.gender,
                date_of_birth: subUsr.date_of_birth,
                looking_for: subUsr.looking_for,
                relationship_goal: subUsr.relationship_goal,
                children: subUsr.children,
                kind_of_person: subUsr.kind_of_person,
                feel_around_new_people: subUsr.feel_around_new_people,
                prefer_spending_time: subUsr.prefer_spending_time,
                describe_you_better: subUsr.describe_you_better,
                describe_role_in_relationship: subUsr.describe_role_in_relationship,
                password: "Password@",
                step: 3,
                onboarded: true,
                first_name: subUsr.first_name,
                last_name: subUsr.last_name,
              },
              default_account: subAccount.id,
            });


            if (saveSubUser) {
              const saveSubEventRegistration =
                await registeredParticipantCreate({
                  user_id: new mongoose.Types.ObjectId(saveSubUser._id),
                  event_id: new mongoose.Types.ObjectId(eventId),
                  first_name: subUsr.first_name,
                  last_name: subUsr.last_name,
                  gender: subUsr.gender,
                  date_of_birth: subUsr.date_of_birth,
                  email: subUsr.email,
                  status: "registered",
                  is_main_user: false,
                  looking_for: subUsr.looking_for,
                  relationship_goal: subUsr.relationship_goal,
                  children: subUsr.children,
                  kind_of_person: subUsr.kind_of_person,
                  feel_around_new_people: subUsr.feel_around_new_people,
                  prefer_spending_time: subUsr.prefer_spending_time,
                  describe_you_better: subUsr.describe_you_better,
                  describe_role_in_relationship: subUsr.describe_role_in_relationship,
                  is_test: true,
                  age_group: subUsr.age_group
                });

              if (saveSubEventRegistration) {
                subParticipantId = saveSubEventRegistration._id;
                invitedUserId = saveSubUser._id;
              }
            }
          }

          // --- MAIN TRANSACTION ---
          const transi = await transactionCreate({
            user_id: new mongoose.Types.ObjectId(saveUser._id),
            participant_id: new mongoose.Types.ObjectId(
              saveEventRegistration._id
            ),
            type: "Register Event",
            amount: 20,
            event_id: new mongoose.Types.ObjectId(eventId),
            status: "paid",
            sub_participant_id: subParticipantId
              ? new mongoose.Types.ObjectId(subParticipantId)
              : null,
            invited_user_id: invitedUserId
              ? new mongoose.Types.ObjectId(invitedUserId)
              : null,
          });

          console.log("transaction created: ", transi._id);
        }
      }
    }));

  // const usersToCreate = participantsData.map((p) => ({
  //   id: uuidv4(), // Schema requires a UUID
  //   name: `${p.first_name} ${p.last_name}`,
  //   first_name: p.first_name,
  //   last_name: p.last_name,
  //   email: p.email,
  //   gender: p.gender,
  //   date_of_birth: new Date(p.date_of_birth),
  //   date_created: new Date(),
  //   last_active: new Date(),
  //   support_enabled: false,
  //   "2fa_enabled": false,
  //   verified: true, // Assume users are verified for simplicity
  // }));

  // const createdUsers = await User.schema.insertMany(usersToCreate);
  // console.log(`-> ${createdUsers.length} users created.`);
  return createdUser;
}

/**
 * Generates and saves bar/location data to the database.
 */
async function seedBars(cityId) {
  console.log(`Step 3: Generating and seeding ${BAR_INPUTS.length} bars...`);
  const barsData = generateBarData(BAR_INPUTS);

  // The generator doesn't provide all required fields, so we augment the data here.
  const locationsToCreate = barsData.map((bar) => ({
    name: bar.name || `Meow - ${Date.now()}`,
    city: cityId,
    address: `${bar.name} Street 1, Munich`, // Dummy address
    contact_person: "Test Contact",
    contact_details: "test@contact.com",
  }));

  const createdLocations = await Location.schema.insertMany(locationsToCreate);

  // IMPORTANT: We need to attach the capacity back to the created objects for the next step.
  const createdBarsWithCapacity = createdLocations.map((loc, index) => ({
    ...loc.toObject(),
    available_spots: barsData[index].available_spots,
  }));

  console.log(`-> ${createdBarsWithCapacity.length} bars (locations) created.`);
  return createdBarsWithCapacity;
}

/**
 * Creates a single event, setting its date to be within the cron job's 36-hour window.
 */
async function seedEvent(cityId, createdBars) {
  console.log("Step 4: Creating the event...");

  // Map the created bars to the format required by the EventManagementSchema's 'bars' array.
  // NOTE: This assumes 'BarReferenceSchema' is { bar: ObjectId, available_spots: Number }
  // You may need to adjust this based on the actual sub-schema definition.
  const barReferences = createdBars.map(bar => ({
        _id: new mongoose.Types.ObjectId(), // <-- THE FIX: Add a new ObjectId for the subdocument itself
        bar: bar._id, // The ObjectId of the referenced Location document
        available_spots: bar.available_spots
    }));

  const eventData = {
    // Set the event for 35 hours from now, so the cron job (which looks <36h ahead) will pick it up.
    date: moment().tz("Europe/Berlin").add(75, "hours").toDate(),
    city: cityId,
    bars: barReferences,
    start_time: "19:00",
    end_time: "23:00",
    is_draft: false,
    tagline: `Test Event - ${TOTAL_PARTICIPANTS} Participants for Cron Job`,
  };

  try {
    const createdEvent = await EventManagement.create(eventData);
    console.log(
      `-> Event created for ${moment(createdEvent.date).format("YYYY-MM-DD")}.`
    );
    return createdEvent;
  } catch (error) {
    console.error("!!! Error creating event:", error);
    return null;
  }
}

/**
 * Registers users for the specified event.
 */
async function registerUsersForEvent(users, event) {
  console.log(`Step 5: Registering ${users.length} users for the event...`);

  const registrationsToCreate = users.map((user) => ({
    user_id: user._id,
    event_id: event,
    first_name: user.first_name,
    last_name: user.last_name,
    gender: user.gender,
    date_of_birth: user.date_of_birth,
    email: user.email,
    status: 'registered'
  }));

  // Note: Assuming the RegisteredParticipant model is exported similarly, with the model on the '.schema' property
  const registrations = await RegisteredParticipant.schema.insertMany(
    registrationsToCreate
  );
  console.log(`-> ${registrations.length} registration documents created.`);
}

/**
 * =================================================================================
 * SCRIPT EXECUTION
 * =================================================================================
 */

// This block executes the script when run directly from the command line.
if (require.main === module) {
  (async () => {
    try {
      // Replace with your actual database connection logic
      await mongo.connect();
      console.log("MongoDB connected successfully.");

      await populateDatabase();
    } catch (error) {
      console.error("An error occurred during the population script:", error);
    } finally {
      await mongoose.connection.close();
      console.log("MongoDB connection closed.");
      process.exit(0);
    }
  })();
}

// Export the main function in case you want to call it from your test runner file
module.exports = { populateDatabase };
