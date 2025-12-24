const mongoose = require('mongoose');
const utility = require('../helper/utility');
const Schema = mongoose.Schema;

const TransactionSchema = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  participant_id: { type: Schema.Types.ObjectId, ref: 'RegisteredParticipant' },
  sub_participant_id: { type: [Schema.Types.ObjectId], ref: 'RegisteredParticipant', default: null },
  invited_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  type: {
    type: String,
    enum: ['Buy Hearts', 'Register Event'],
    required: true,
  },
  amount: { type: Number, required: true },
  event_id: { type: Schema.Types.ObjectId, ref: 'EventManagement' },
  status: {
    type: String,
    enum: ['unpaid', 'paid'],
    default: 'unpaid'
  },
  quantity: { type: Number, default: 1 },
}, { versionKey: false, timestamps: true });

const Transaction = mongoose.model('Transaction', TransactionSchema, 'transactions');
exports.schema = Transaction;

function calculateAge(dateOfBirth) {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/*
* transaction.getById()
*/
exports.getByUserId = async function ({ user_id }) {
  let data = await Transaction
    .find({ user_id });

  if (data?.length){
    data = data.map((dt) => {
      return {
        date: utility.formatDateString(dt.createdAt),
        item: dt.type,
        amount: dt.amount,
        quantity: dt.quantity,
        payment_status: dt.status,
        id: dt._id
      }
    })
  }

  return data;
};

/*
* transaction.getByEventId()
*/
exports.getByEventId = async function ({ event_id }) {
  let data = await Transaction
    .find({ event_id })
    .populate('user_id', 'first_name last_name id date_of_birth name')
    .populate('invited_user_id', 'first_name last_name id date_of_birth name')
    .sort({ createdAt: -1 });

  return data;
};

/*
* transaction.getByEventIdCron()
*/
exports.getByEventIdCron = async function ({ event_id }) {
  let data = await Transaction
    .find({ event_id, status: 'paid' })
    .populate('user_id', '_id date_of_birth name')
    .populate('invited_user_id', '_id date_of_birth name');;

  return data;
};

/*
* transaction.getParticipantsCron()
*/
exports.getParticipantsCron = async function ({ event_id }) {
  const oid = new mongoose.Types.ObjectId(event_id);

  const agg = [
    { $match: { event_id: oid, status: 'paid' } },

    // lookup main registered participant
    {
      $lookup: {
        from: 'registered-participants',
        localField: 'participant_id',
        foreignField: '_id',
        as: 'participant'
      }
    },
    // participant becomes single object or missing
    { $unwind: { path: '$participant', preserveNullAndEmptyArrays: true } },

    // lookup all sub participants (array)
    {
      $lookup: {
        from: 'registered-participants',
        localField: 'sub_participant_id',
        foreignField: '_id',
        as: 'sub_participants'
      }
    },
    {
      $addFields: {
        participant: {
          $cond: [
            { $eq: ['$participant.is_cancelled', true] }, // if explicitly true
            null,
            '$participant' // else keep it (null/false/missing are preserved)
          ]
        },
        sub_participants: {
          $filter: {
            input: '$sub_participants',
            as: 'sp',
            cond: { $ne: ['$$sp.is_cancelled', true] } // keep if is_cancelled != true
          }
        }
      }
    },

    // Keep only transactions that have at least one non-cancelled participant
    {
      $match: {
        $or: [
          { participant: { $ne: null } },           // main participant exists and not cancelled
          { 'sub_participants.0': { $exists: true } } // or at least one sub participant exists
        ]
      }
    },

    // Project fields you care about (adjust to include/remove fields)
    {
      $project: {
        user_id: 1,
        type: 1,
        amount: 1,
        event_id: 1,
        status: 1,
        quantity: 1,
        createdAt: 1,
        updatedAt: 1,
        participant_id: {
          _id: '$participant._id',
          user_id: '$participant.user_id',
          first_name: '$participant.first_name',
          last_name: '$participant.last_name',
          gender: '$participant.gender',
          date_of_birth: '$participant.date_of_birth',
          email: '$participant.email',
          is_main_user: '$participant.is_main_user',
          is_cancelled: '$participant.is_cancelled',
          // looking_for: '$participant.looking_for',
          // relationship_goal: '$participant.relationship_goal',
          // children: '$participant.children',
          // kind_of_person: '$participant.kind_of_person',
          // feel_around_new_people: '$participant.feel_around_new_people',
          // prefer_spending_time: '$participant.prefer_spending_time',
          // describe_you_better: '$participant.describe_you_better',
          // describe_role_in_relationship: '$participant.describe_role_in_relationship',
          email: '$participant.email'
        },
        sub_participants: 1 // already filtered
      }
    }
  ];

  let data = await Transaction.aggregate(agg).exec();

  // 🔥 filter out transactions where participant and subparticipant are all null/empty
  data = data.filter(item => item.participant_id);

  return data.map(item => {
    // choose the "sub participant": prefer sub_participant_id[0], else invited_user_id
    let sub = null;
    if (item.sub_participants?.length) {
      sub = item.sub_participants[0];
    }

    return {
      user_id: item.user_id,
      name: `${item.participant_id?.first_name} ${item.participant_id?.last_name}`,
      gender: item.participant_id?.gender,
      age: calculateAge(item.participant_id?.date_of_birth),
      looking_for: item.participant_id?.looking_for,
      relationship_goal: item.participant_id?.relationship_goal,
      children: item.participant_id?.children,
      kind_of_person: item.participant_id?.kind_of_person,
      feel_around_new_people: item.participant_id?.feel_around_new_people,
      prefer_spending_time: item.participant_id?.prefer_spending_time,
      describe_you_better: item.participant_id?.describe_you_better,
      describe_role_in_relationship: item.participant_id?.describe_role_in_relationship,
      email: item.participant_id?.email,
      first_name: item.participant_id?.first_name,
      last_name: item.participant_id?.last_name,
      invited_user_id: sub && {
        ...sub,
        age: calculateAge(sub?.date_of_birth),
        user_id: sub._id,
        email: sub.email,
        first_name: sub.first_name,
        last_name: sub.last_name,
      }
    };
  });
};

