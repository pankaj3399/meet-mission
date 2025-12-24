const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const moment = require('moment-timezone');

// Reference Location model
const Location = require('./location').schema;
const City = require('./city').schema;

// Bar sub-schema referencing Location
const BarReferenceSchema = new Schema({
  _id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
  available_spots: { type: Number, required: true },
}, { _id: false });

const EventManagementSchema = new Schema({
  date: { type: Date, required: true },
  city: { type: Schema.Types.ObjectId, ref: 'City', required: true },
  bars: { type: [BarReferenceSchema], required: true },
  start_time: { type: String, required: true }, // e.g., '18:00'
  end_time: { type: String, required: true },   // e.g., '23:00'
  image: { type: String, default: '' },
  is_draft: { type: Boolean, default: false },
  is_canceled: { type: Boolean, default: false },
  has_grouped_by_ai: { type: Boolean, default: false },
  tagline: { type: String, required: true },
  capacity_warning_sent: { type: Boolean, default: false } // Track if 90% warning sent
}, { timestamps: true });

const EventManagement = mongoose.model('EventManagement', EventManagementSchema, 'event-management');
exports.schema = EventManagement;

// Create eventManagement
exports.create = async function (event) {
  console.log("create event called in meet mission: ", event);
  const data = new EventManagement({
    date: event.date,
    city: event.city,
    bars: event.bars,
    start_time: event.start_time,
    end_time: event.end_time,
    image: event.image || '',
    status: event.status,
    is_draft: event.is_draft,
    tagline: event.tagline,
    capacity_warning_sent: false // Initialize warning flag
  });

  await data.save();
  return data;
};

// Get all events with optional filters
exports.get = async function ({ search = '', city = '' }) {
  const matchStage = {};

  if (city) {
    matchStage.city = new mongoose.Types.ObjectId(city);
  }

  if (search) {
    const cityMatches = await mongoose.model('City').find({
      name: { $regex: search, $options: 'i' }
    }).select('_id');

    const matchedCityIds = cityMatches.map(c => c._id);
    matchStage.$or = [
      { status: { $regex: search, $options: 'i' } },
      { city: { $in: matchedCityIds } }
    ];
  }

  const pipeline = [
    { $match: matchStage },

    // Lookup city
    {
      $lookup: {
        from: 'city',
        localField: 'city',
        foreignField: '_id',
        as: 'city'
      }
    },
    { $unwind: { path: '$city', preserveNullAndEmptyArrays: true } },

    // Lookup bars
    {
      $unwind: {
        path: '$bars',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $lookup: {
        from: 'location',
        localField: 'bars._id',
        foreignField: '_id',
        as: 'bar_info'
      }
    },
    {
      $unwind: {
        path: '$bar_info',
        preserveNullAndEmptyArrays: true
      }
    },

    // Group bars back together
    {
      $group: {
        _id: '$_id',
        date: { $first: '$date' },
        city: { $first: '$city' },
        start_time: { $first: '$start_time' },
        end_time: { $first: '$end_time' },
        tagline: { $first: '$tagline' },
        image: { $first: '$image' },
        is_draft: { $first: '$is_draft' },
        is_canceled: { $first: '$is_canceled' },
        bars: {
          $push: {
            _id: '$bars._id',
            available_spots: '$bars.available_spots',
            name: '$bar_info.name',
            address: '$bar_info.address',
            image: '$bar_info.image',
            contact_person: '$bar_info.contact_person',
            contact_details: '$bar_info.contact_details'
          }
        }
      }
    },
    {
      $addFields: {
        status: {
          $switch: {
            branches: [
              { case: { $eq: ['$is_canceled', true] }, then: 'Canceled' },
              { case: { $eq: ['$is_draft', true] }, then: 'Draft' },
              { case: { $lt: ['$date', new Date()] }, then: 'Past Event' }
            ],
            default: 'Published'
          }
        }
      }
    },

    // Count registered participants
    {
      $lookup: {
        from: 'registered-participants', // check your actual collection name
        let: { eventId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$event_id', '$$eventId'] },
                  { $eq: ['$status', 'registered'] },
                  {
                    $or: [
                      { $eq: ['$is_cancelled', false] },
                      { $not: ['$is_cancelled'] }
                    ]
                  }
                ]
              }
            }
          }
        ],
        as: 'registrations'
      }
    },
    {
      $addFields: {
        registered_count: { $size: '$registrations' }
      }
    },
    {
      $addFields: {
        // Calculate total capacity from bars
        total_capacity: {
          $sum: '$bars.available_spots'
        },
        // Calculate capacity percentage (as integer)
        capacity_percentage: {
          $cond: {
            if: { $gt: [{ $sum: '$bars.available_spots' }, 0] },
            then: {
              $round: [
                {
                  $multiply: [
                    { $divide: [{ $size: '$registrations' }, { $sum: '$bars.available_spots' }] },
                    100
                  ]
                }
              ]
            },
            else: 0
          }
        },
        // Check if capacity warning should be shown (90%+ threshold for frontend display)
        capacity_warning: {
          $gte: [{ $size: '$registrations' }, { $multiply: [{ $sum: '$bars.available_spots' }, 0.9] }]
        },
        // Check if event is at full capacity
        is_at_capacity: {
          $gte: [{ $size: '$registrations' }, { $sum: '$bars.available_spots' }]
        }
      }
    },
    {
      $project: {
        registrations: 0 // exclude raw participant docs
      }
    },

    { $sort: { date: -1 } }
  ];

  const results = await mongoose.model('EventManagement').aggregate(pipeline);
  return results;
};

// Get one event by ID
exports.getById = async function ({ id }) {
  const pipeline = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },

    // Lookup city
    {
      $lookup: {
        from: 'city',
        localField: 'city',
        foreignField: '_id',
        as: 'city'
      }
    },
    { $unwind: { path: '$city', preserveNullAndEmptyArrays: true } },

    // Unwind bars for enrichment
    {
      $unwind: {
        path: '$bars',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $lookup: {
        from: 'location',
        localField: 'bars._id',
        foreignField: '_id',
        as: 'bar_info'
      }
    },
    {
      $unwind: {
        path: '$bar_info',
        preserveNullAndEmptyArrays: true
      }
    },

    // Group back bars
    {
      $group: {
        _id: '$_id',
        date: { $first: '$date' },
        city: { $first: '$city' },
        start_time: { $first: '$start_time' },
        end_time: { $first: '$end_time' },
        tagline: { $first: '$tagline' },
        image: { $first: '$image' },
        is_draft: { $first: '$is_draft' },
        is_canceled: { $first: '$is_canceled' },
        bars: {
          $push: {
            _id: '$bars._id',
            available_spots: '$bars.available_spots',
            name: '$bar_info.name',
            address: '$bar_info.address',
            image: '$bar_info.image',
            contact_person: '$bar_info.contact_person',
            contact_details: '$bar_info.contact_details'
          }
        }
      }
    },

    // Status logic
    {
      $addFields: {
        status: {
          $switch: {
            branches: [
              { case: { $eq: ['$is_canceled', true] }, then: 'Canceled' },
              { case: { $eq: ['$is_draft', true] }, then: 'Draft' },
              { case: { $lt: ['$date', new Date()] }, then: 'Past Event' }
            ],
            default: 'Published'
          }
        }
      }
    },

    // Count registered participants
    {
      $lookup: {
        from: 'registered-participants',
        let: { eventId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$event_id', '$$eventId'] },
                  { $eq: ['$status', 'registered'] },
                  {
                    $or: [
                      { $eq: ['$is_cancelled', false] },
                      { $not: ['$is_cancelled'] }
                    ]
                  }
                ]
              }
            }
          }
        ],
        as: 'registrations'
      }
    },

    {
      $project: {
        registrations: 0
      }
    }
  ];

  const result = await mongoose.model('EventManagement').aggregate(pipeline);
  return result?.[0] || null;
};


// Get event locations
exports.getLocations = async function ({ id }) {
  return await EventManagement
    .findOne({ _id: id })
    .populate('bars._id', 'name address image contact_person contact_details')
    .select('bars');
};

// Update event
exports.update = async function ({ id, data }) {
  const updated = await EventManagement.findOneAndUpdate({ _id: id }, data, { new: true });
  return updated;
};

// Delete event
exports.delete = async function ({ id }) {
  if (!id) throw { message: 'Please provide an event ID' };
  await EventManagement.deleteOne({ _id: id });
  return id;
};

// Cancel event
exports.cancel = async function ({ id, isCanceled }) {
  if (!id) throw { message: 'Please provide an event ID' };
  await EventManagement.findOneAndUpdate({ _id: id }, { is_canceled: isCanceled }, { new: true });
  return id;
};

exports.getEventCron = async function ({day, generated}) {
  // Set to Europe/Berlin at 00:00 of target day
  const targetDate = moment().tz('Europe/Berlin').add(day, 'days').startOf('day');
  const nextDay = targetDate.clone().add(1, 'day');

  // Convert to JS Date for MongoDB queries
  const targetDateUTC = targetDate.toDate();
  const nextDayUTC = nextDay.toDate();

  console.log('targetDate : ', targetDate.toString(), 'nextDay :', nextDay.toString());

  const matchStage = {
    date: {
      $gte: targetDateUTC,
      $lt: nextDayUTC
    },
    $and: [
      {
        $or: [
          { is_draft: false },
          { is_draft: { $exists: false } },
          { is_draft: null }
        ]
      },
      {
        $or: [
          { is_canceled: false },
          { is_canceled: { $exists: false } },
          { is_canceled: null }
        ]
      },
      generated ? {
        has_grouped_by_ai: true
      }
      : {
        $or: [
          { has_grouped_by_ai: false },
          { has_grouped_by_ai: { $exists: false } },
          { has_grouped_by_ai: null }
        ]
      },
    ]
  };

  const pipeline = [
    { $match: matchStage },
    // Lookup city
    {
      $lookup: {
        from: 'city',
        localField: 'city',
        foreignField: '_id',
        as: 'city'
      }
    },
    { $unwind: { path: '$city', preserveNullAndEmptyArrays: true } },
    // Lookup bars
    { $unwind: { path: '$bars', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'location',
        localField: 'bars._id',
        foreignField: '_id',
        as: 'bar_info'
      }
    },
    { $unwind: { path: '$bar_info', preserveNullAndEmptyArrays: true } },

    // Group bars back together
    {
      $group: {
        _id: '$_id',
        date: { $first: '$date' },
        city: { $first: '$city' },
        start_time: { $first: '$start_time' },
        end_time: { $first: '$end_time' },
        tagline: { $first: '$tagline' },
        bars: {
          $push: {
            _id: '$bars._id',
            available_spots: '$bars.available_spots',
            name: '$bar_info.name'
          }
        }
      }
    },
    { $sort: { date: -1 } }
  ];

  const results = await mongoose.model('EventManagement').aggregate(pipeline);
  return results;
};

exports.getSwipeEventCron = async function ({ generated }) {
  // Get current time in Germany time
  const berlinNow = moment().tz('Europe/Berlin');

  // Calculate the start and end range
  const start = berlinNow.clone().set({ hour: 23, minute: 0, second: 0, millisecond: 0 });
  const end = start.clone().add(1, 'day');

  console.log('Berlin Start (23:00):', start.toDate());
  console.log('Berlin End (+1 day 23:00):', end.toDate());

  const matchStage = {
    date: {
      $gte: start.toDate(),
      $lt: end.toDate()
    },
    $and: [
      {
        $or: [
          { is_draft: false },
          { is_draft: { $exists: false } },
          { is_draft: null }
        ]
      },
      {
        $or: [
          { is_canceled: false },
          { is_canceled: { $exists: false } },
          { is_canceled: null }
        ]
      },
      generated
        ? { has_grouped_by_ai: true }
        : {
            $or: [
              { has_grouped_by_ai: false },
              { has_grouped_by_ai: { $exists: false } },
              { has_grouped_by_ai: null }
            ]
          }
    ]
  };

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'city',
        localField: 'city',
        foreignField: '_id',
        as: 'city'
      }
    },
    { $unwind: { path: '$city', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$bars', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'location',
        localField: 'bars._id',
        foreignField: '_id',
        as: 'bar_info'
      }
    },
    { $unwind: { path: '$bar_info', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$_id',
        date: { $first: '$date' },
        city: { $first: '$city' },
        start_time: { $first: '$start_time' },
        end_time: { $first: '$end_time' },
        tagline: { $first: '$tagline' },
        bars: {
          $push: {
            _id: '$bars._id',
            available_spots: '$bars.available_spots',
          }
        }
      }
    },
    { $sort: { date: -1 } }
  ];

  const results = await mongoose.model('EventManagement').aggregate(pipeline);
  return results;
};

exports.getEndEventCron = async function ({ generated }) {
  // Get current time in Germany time
  // const berlinNow = moment().tz('Europe/Berlin');

  // // Calculate the start and end range
  // const start = berlinNow.clone().set({ hour: 23, minute: 0, second: 0, millisecond: 0 });
  // const end = start.clone().add(1, 'day');

  // console.log('Berlin Start (23:00):', start.toDate());
  // console.log('Berlin End (+1 day 23:00):', end.toDate());
  const today = moment().tz('Europe/Berlin').startOf('day').toDate();
  // const today = moment().tz('Europe/Berlin').startOf('day');
  // const testDay = today.clone().add(17, 'days').toDate(); // ✅ works
  // console.log(testDay, 'testDay');

  const matchStage = {
    $and: [
      {
        $or: [
          { is_draft: false },
          { is_draft: { $exists: false } },
          { is_draft: null }
        ]
      },
      {
        $or: [
          { is_canceled: false },
          { is_canceled: { $exists: false } },
          { is_canceled: null }
        ]
      },
      generated
        ? { has_grouped_by_ai: true }
        : {
            $or: [
              { has_grouped_by_ai: false },
              { has_grouped_by_ai: { $exists: false } },
              { has_grouped_by_ai: null }
            ]
          }
    ]
  };

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'city',
        localField: 'city',
        foreignField: '_id',
        as: 'city'
      }
    },
    { $unwind: { path: '$city', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$bars', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'location',
        localField: 'bars._id',
        foreignField: '_id',
        as: 'bar_info'
      }
    },
    { $unwind: { path: '$bar_info', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        eventStart: {
          $add: [
            '$date',
            1000 * 60 * 60 * 24 * 27 // +27 days
          ]
        },
        eventEnd: {
          $add: [
            '$date',
            1000 * 60 * 60 * 24 * 28 // +28 days
          ]
        }
      }
    },
    {
      $match: {
        $or: [
          { eventStart: { $gte: today } },         // Future or today
          {
            $and: [
              { eventStart: { $lt: today } },      // Past
              { eventEnd: { $gte: today } }        // ...but within 28 days
            ]
          }
        ]
      }
    },
    {
      $group: {
        _id: '$_id',
        date: { $first: '$date' },
        city: { $first: '$city' },
        start_time: { $first: '$start_time' },
        end_time: { $first: '$end_time' },
        tagline: { $first: '$tagline' },
        bars: {
          $push: {
            _id: '$bars._id',
            available_spots: '$bars.available_spots',
          }
        }
      }
    },
    { $sort: { date: -1 } }
  ];

  const results = await mongoose.model('EventManagement').aggregate(pipeline);
  return results;
};

exports.getEventNeedAttention = async function () {
  // today start in Europe/Berlin
  const today = moment().tz('Europe/Berlin').startOf('day').toDate();

  const matchStage = {
    date: { $gte: today }, // ✅ only upcoming / active events
    has_grouped_by_ai: true, // ✅ only AI-grouped
    $and: [
      {
        $or: [
          { is_draft: false },
          { is_draft: { $exists: false } },
          { is_draft: null }
        ]
      },
      {
        $or: [
          { is_canceled: false },
          { is_canceled: { $exists: false } },
          { is_canceled: null }
        ]
      }
    ]
  };

  const pipeline = [
    { $match: matchStage },
    // Lookup city
    {
      $lookup: {
        from: 'city',
        localField: 'city',
        foreignField: '_id',
        as: 'city'
      }
    },
    { $unwind: { path: '$city', preserveNullAndEmptyArrays: true } },

    // Lookup bars
    { $unwind: { path: '$bars', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'location',
        localField: 'bars._id',
        foreignField: '_id',
        as: 'bar_info'
      }
    },
    { $unwind: { path: '$bar_info', preserveNullAndEmptyArrays: true } },

    // Group bars back together
    {
      $group: {
        _id: '$_id',
        date: { $first: '$date' },
        city: { $first: '$city' },
        start_time: { $first: '$start_time' },
        end_time: { $first: '$end_time' },
        tagline: { $first: '$tagline' },
        bars: {
          $push: {
            _id: '$bars._id',
            available_spots: '$bars.available_spots',
            name: '$bar_info.name'
          }
        }
      }
    },
    { $sort: { date: 1 } } // upcoming first
  ];

  const results = await mongoose.model('EventManagement').aggregate(pipeline);
  return results;
};
