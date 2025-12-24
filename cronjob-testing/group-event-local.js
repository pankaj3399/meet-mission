require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const moment = require('moment-timezone');
const mongo = require('../model/mongo/mongo')
const { generateTeamGroup, eventStartReminder, swipeEventStartReminder, eventEndReminder } = require('../controller/aiController');

const { populateDatabase } = require('./populate-data');

require('../helper/i18n').config();

async function runAIJobForGrouping() {
  console.log('AI Grouping Start');
  try {
    await generateTeamGroup();
    console.log('AI Grouping Finish');
  } catch (err) {
    console.error('AI Grouping job error:', err);
  }
}

async function runAIJobForEventStartReminder() {
  console.log('AI Event Reminder Start');
  try {
    await eventStartReminder();
    console.log('AI Event Reminder Finish');
  } catch (err) {
    console.error('AI Event Reminder job error:', err);
  }
}

async function runAIJobForSwipeEventStartReminder() {
  console.log('AI Swipe Event Reminder Start');
  try {
    await swipeEventStartReminder();
    console.log('AI Swipe Event Reminder Finish');
  } catch (err) {
    console.error('AI Swipe Event Reminder job error:', err);
  }
}

async function runAIJobForEndEventReminder() {
  console.log('AI End Event Reminder Start');
  try {
    await eventEndReminder();
    console.log('AI End Event Reminder Finish');
  } catch (err) {
    console.error('AI End Event Reminder job error:', err);
  }
}

if (require.main === module) {
  (async () => {
    await mongo.connect();

    await populateDatabase();

    setTimeout(async () => {
      await runAIJobForGrouping();
      await runAIJobForEventStartReminder();
      await runAIJobForSwipeEventStartReminder();
      await runAIJobForEndEventReminder();

      mongoose.connection.close();
      process.exit(0);
    }, 3000);
  })();
}
