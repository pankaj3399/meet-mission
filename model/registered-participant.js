const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const Transaction = require('./transaction').schema;

// Main schema
const RegisteredParticipantSchema = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  event_id: { type: Schema.Types.ObjectId, ref: 'EventManagement', required: true },
  first_name: { type: String },
  last_name: { type: String },
  gender: { type: String, enum: ['male', 'female', 'diverse'], default: null },
  date_of_birth: { type: Date },
  email: { type: String, required: true },
  status: {
    type: String,
    enum: ['process','waitlist','registered', 'canceled'],
    default: 'registered'
  },
  is_main_user: { type: Boolean, default: null },
  is_cancelled: { type: Boolean, default: null },
  cancel_date: { type: Date },
  looking_for: { type: String },
  relationship_goal: { type: String, default: null },
  children: { type: Boolean, default: null },
  kind_of_person: { type: String, default: null },
  feel_around_new_people: { type: String, default: null },
  prefer_spending_time: { type: String, default: null },
  describe_you_better: { type: String, default: null },
  describe_role_in_relationship: { type: String, default: null },
  is_test: { type: Boolean, default: null },
}, { versionKey: false, timestamps: true });

// Model
const RegisteredParticipant = mongoose.model('RegisteredParticipant', RegisteredParticipantSchema, 'registered-participants');
exports.schema = RegisteredParticipant;

/*
 * registeredParticipant.create()
 */
exports.create = async function (registration) {
  const data = new RegisteredParticipant({
    user_id: registration.user_id,
    event_id: registration.event_id,
    first_name: registration.first_name,
    last_name: registration.last_name,
    gender: registration.gender || null,
    date_of_birth: registration.date_of_birth,
    email: registration.email,
    status: registration.status || 'registered',
    is_main_user: registration.is_main_user ?? null
  });

  await data.save();
  return data;
};

/*
* registeredParticipant.getByEventId()
*/
exports.getByEventId = async function ({ event_id }) {

  return await RegisteredParticipant
    .find({ event_id });
};

/*
* registeredParticipant.getRegistered()
*/
exports.getRegistered = async function ({ event_id, isValid }) {
  const matchStage = {
    event_id,
    status: 'registered'
  };

  // If isValid is true, only include valid main users
  if (isValid) {
    matchStage.$or = [
      { is_canceled: false },
      { is_canceled: { $exists: false } },
      { is_canceled: null }
    ];
  }

  return await RegisteredParticipant.aggregate([
    { $match: matchStage },
    // Lookup from User collection
    {
      $lookup: {
        from: 'users', // name of the collection (usually lowercase plural)
        localField: 'user_id',
        foreignField: '_id',
        as: 'user'
      }
    },
    {
      $unwind: {
        path: '$user',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $addFields: {
        age: {
          $dateDiff: {
            startDate: '$date_of_birth',
            endDate: '$$NOW',
            unit: 'year'
          }
        }
      }
    },
    {
      $addFields: {
        age_group: {
          $switch: {
            branches: [
              { case: { $lte: ['$age', 30] }, then: '18–30' },
              { case: { $and: [ { $gt: ['$age', 30] }, { $lte: ['$age', 40] } ] }, then: '31–40' }
            ],
            default: '41–50+'
          }
        }
      }
    },
    {
      $project: {
        _id: 1,
        user_id: 1,
        first_name: 1,
        last_name: 1,
        email: {
          $ifNull: ['$email', '$user.email'] // use email from RegisteredParticipant, fallback to User.email
        },
        locale: 1,
        age_group: 1
      }
    }
  ]);
};
