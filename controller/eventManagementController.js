const event = require('../model/event-management');
const ConfirmedMatch = require('../model/confirm-match');
const group = require('../model/group');
const teams = require('../model/team');
const user = require('../model/user');
const utility = require('../helper/utility');
const mongoose = require('mongoose');
const s3 = require('../helper/s3');
const path = require('path');
const mail = require('../helper/mail');
const registeredParticipant = require('../model/registered-participant');
const stripe = require('../model/stripe');
const moment = require('moment-timezone');
const {checkBarCapacities} = require('../helper/teamHelper');
const { log } = require('console');

/*
 * event.get()
 */
exports.get = async function (req, res) {
  try {
    const { search = '', city = '', status = '', barId = '' } = req.query;
    const query = {};

    if (city) query.city = city;
    if (status) query.status = status;
    if (barId) query['bars._id'] = barId;

    if (search) {

    }

    const events = await event.get(query);
    return res.status(200).send({ data: events });
  } catch (err) {
    return res.status(500).send({ error: err.message });
  }
};

/*
 * event.getLocationNeedAttention()
 */
exports.getLocationNeedAttention = async function (req, res) {
  try {
    const events = await event.getEventNeedAttention();
    const results = {};

    for (const ev of events) {
      // groupsAndRounds should be your grouped structure from DB
      const groupsAndRounds = await group.getEventGroupStats(ev._id);
      const bars = ev.bars;
      if(groupsAndRounds?.barRoundUsage){
        for (const [barId, rounds] of Object.entries(groupsAndRounds?.barRoundUsage)) {
          const bar = bars.find(b => String(b._id) === String(barId));
          if (!bar) continue;
          let seats = 0;
          for (const [round, data] of Object.entries(rounds)) {
            const { total } = data;
            total > seats && (seats = total);
          }
          if(seats > bar.available_spots){
            if(results[ev._id] === undefined){
              results[ev._id] = {
                name: ev.city.name,
                date: ev.date,
                tagline: ev.tagline,
                bars: [
                  {
                    bar_id: barId,
                    available_spots: bar.available_spots,
                    total_needed: seats - bar.available_spots,
                    bar_name: bar.name,
                  }
                ]
              }
            } else {
              results[ev._id].bars.push({
                bar_id: barId,
                available_spots: bar.available_spots,
                total_needed: seats - bar.available_spots,
                bar_name: bar.name,
              })
            }
          }
        }
      }
    }

    return res.status(200).send({ data: results });
  } catch (err) {
    console.error(err);
    return res.status(500).send({ error: err.message });
  }
};


/*
 * event.create()
 */
exports.create = async function (req, res) {

  const data = req.body;

  // Required field validation
  utility.assert(data, ['date', 'city', 'bars', 'start_time', 'end_time', 'tagline'], 'Please check your required inputs again');

  try {
    const { image } = data;

    if (image) {
      const ext = path.extname(image).slice(1);
      const newImageName = `event-${Date.now()}.${ext}`;

      const previewSignedUrl = await s3.signedURL({
        filename: `${newImageName}`,
        acl: 'bucket-owner-full-control',
        // 'public-read',
        contentType: `image/${ext}`,
      });
      data.image = newImageName;

      await event.create(data);

      return res.status(200).send({
        files_to_upload: [{ name: image, url: previewSignedUrl }],
        message: 'Uploading the event image, please do not close this window yet.'
      });
    } else {
      data.bars = data.bars.map((dt) => {
        return {
          _id: new mongoose.Types.ObjectId(dt.name),
          available_spots: dt.available_spots
        }
      })
      data.is_draft = data.is_draft || false
      await event.create(data);
      return res.status(200).send({ message: `Event created successfully` });
    }

  } catch (err) {
    return res.status(400).send({ error: err.message });
  }
};

/*
 * event.update()
 */
exports.update = async function (req, res) {
  const id = req.params.id;
  const data = req.body;

  try {
    utility.validate(id);
    const existing = await event.getById({ id: new mongoose.Types.ObjectId(id) });
    utility.assert(existing, 'Event not found');
    data.bars = data.bars.map((dt) => {
      return {
        _id: new mongoose.Types.ObjectId(dt.name),
        available_spots: dt.available_spots
      }
    })
    const image = data.image
    if(data.changeImage){
      const ext = path.extname(image).slice(1);
      const newPreviewImage = `event-${Date.now()}.${ext}`

      const previewSignedUrl = await s3.signedURL({
        filename: `${newPreviewImage}`,
        acl: 'bucket-owner-full-control',
        contentType: `image/${ext}`,
      });
      data.image = newPreviewImage;

      await event.update({ id: new mongoose.Types.ObjectId(id), data });

      return res.status(200).send({

        files_to_upload: [
        { name: image, url: previewSignedUrl }
        ],
        message: 'Uploading the project files, please dont close this window yet.'
      });
    } else {
      delete data.image
    }
    data.is_draft = data.is_draft || false
    await event.update({ id: new mongoose.Types.ObjectId(id), data });
    if(data.subject_email && data.body_email){
      const participants = await registeredParticipant.getRegistered({ event_id:  new mongoose.Types.ObjectId(id), isValid: true });
      if(participants.length){

        for (const participant of participants){
          const participantData = participant;
          if(participantData) {
            const email = participantData.email
            const rex = /^(?:[a-z0-9!#$%&amp;'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&amp;'*+/=?^_`{|}~-]+)*|'(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*')@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/
            if (rex.test(email.toLowerCase())){

              await mail.send({

                to: email,
                locale: 'de',
                template: 'template',
                subject: data.subject_email,
                content: {
                  body: `Hallo ${participantData.first_name},\n\n${data.body_email}`,
                  closing: 'Beste grüße,',
                  button: {
                    url: process.env.CLIENT_URL,
                    label: 'Zum Meetlocal-Dashboard'
                  }
                }
              })

            }
          }
        }
      }
    }
    return res.status(200).send({ message: `Event updated` });
  } catch (err) {
    return res.status(400).send({ error: err.message });
  }
};

/*
 * event.delete()
 */
exports.delete = async function (req, res) {
  const id = req.params.id;

  try {
    utility.validate(id);
    await event.delete({ id: new mongoose.Types.ObjectId(id) });
    return res.status(200).send({ message: `Event deleted` });
  } catch (err) {
    return res.status(400).send({ error: err.message });
  }
};

/*
 * event.getById()
 */
exports.getById = async function (req, res) {
  const id = req.params.id;

  try {
    utility.validate(id);
    const eventData = await event.getById({ id: new mongoose.Types.ObjectId(id) });
    if(eventData.image){
      const ext = await path.extname(eventData.image).slice(1);
      const previewSignedUrl = await s3.signedURLView({
        filename: `${eventData.image}`,
        acl: 'bucket-owner-full-control',
        // 'public-read',
        contentType: `image/${ext}`,
      });
      eventData.image = previewSignedUrl;
    }
    return res.status(200).send({ data: eventData });
  } catch (err) {
    return res.status(400).send({ error: err.message });
  }
};

/*
 * event.getLocations()
 */
exports.getLocations = async function (req, res) {
  const id = req.params.id;

  try {
    utility.validate(id);
    const eventData = await event.getLocations({ id: new mongoose.Types.ObjectId(id) });
    return res.status(200).send({ data: eventData });
  } catch (err) {
    return res.status(400).send({ error: err.message });
  }
};

/*
 * event.cancel()
 */
exports.cancel = async function (req, res) {
  const id = req.params.id;
  const isCanceled = req.body.isCanceled ?? true;

  try {
    utility.validate(id);
    const eventId = new mongoose.Types.ObjectId(id);
    const eventData = await event.getById({ id: eventId });
    utility.assert(eventData, 'Event not found');

    // Update the event flag
    await event.cancel({ id: eventId, isCanceled });

    if (isCanceled) {
      // Issue vouchers only if cancellation is timely (>24h before event start)
      const participants = await registeredParticipant.getRegistered({
        event_id: eventId,
        isValid: true
      });

      const redeemBy = Math.floor(moment().add(24, 'months').valueOf() / 1000);

      for (const p of participants) {
        try {
          // Cancel registration
          await mongoose.model('RegisteredParticipant').findByIdAndUpdate(p._id, {
            status: 'canceled',
            is_cancelled: true,
            cancel_date: new Date()
          });

          // Calculate amount user actually paid
          const txDocs = await mongoose.model('Transaction').find({
            user_id: new mongoose.Types.ObjectId(p.user_id),
            event_id: eventId,
            status: 'paid',
            type: 'Register Event'
          }).lean();

          const amountOffCents = Math.round(
            (txDocs || []).reduce((sum, t) => sum + (typeof t.amount === 'number' ? t.amount * 100 : 0), 0)
          );

          if (!amountOffCents) throw new Error('No paid transaction found for this user');

          // Create coupon and promotion code (single-use)
          const coupon = await stripe.coupon.createOnce({
            amount_off: amountOffCents,
            currency: 'eur',
            redeem_by: redeemBy,
            name: `Voucher - ${eventData.tagline}`.substring(0, 40),
            metadata: { user_id: String(p.user_id), event_id: String(eventId), reason: 'admin_event_cancellation' }
          });
          const code = `MEET-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
          const promo = await stripe.promotionCode.create({
            coupon: coupon.id,
            code,
            expires_at: redeemBy,
            max_redemptions: 1,
            metadata: { user_id: String(p.user_id), event_id: String(eventId), coupon_id: coupon.id }
          });

          // Email user with voucher code
          await mail.send({
            to: p.email,
            locale: p.locale || req.locale || 'de',
            custom: true,
            template: 'event_cancelled',
            subject: req.__('payment.cancelled_event_admin.subject', { city: eventData.city?.name }),
            content: {
              name: `${p.first_name} ${p.last_name}`,
              body: req.__('payment.cancelled_event_admin.body', { event: eventData.tagline, code: promo.code, date: moment.unix(redeemBy).format('YYYY-MM-DD') }),
              button_url: process.env.CLIENT_URL,
              button_label: req.__('payment.cancelled_event_admin.button')
            }
          });

        } catch (e) {
          console.error('Voucher/email failed for participant', p?._id, e);
        }
      }
    }

    return res.status(200).send({
      message: `Event ${isCanceled ? 'canceled' : 'restored'}`
    });

  } catch (err) {
    return res.status(400).send({ error: err.message });
  }
};
/*
 * event.getTeamsByEventId()
 */
exports.getTeamsByEventId = async function (req, res) {
  const id = req.params.id;

  try {
    utility.validate(id);
    const teamData = await teams.get({ eventId: new mongoose.Types.ObjectId(id) });

    const data = teamData?.map((team, i) => {
      return {
        ...team.toObject(),
        _id: team._id,
        no: i + 1,
        first_member_name: team.members?.[0]?.first_name ? `${team.members?.[0]?.first_name} ${team.members?.[0]?.last_name}` : team.members?.[0]?.name,
        team_members: team.members?.map(team => team.first_name ? `${team.first_name} ${team.last_name}` : team.name),
        assignment_method: team.method,
      }
    })
    return res.status(200).send({ data: data });
  } catch (err) {
    return res.status(400).send({ error: err.message });
  }
};

/*
 * event.getTeam()
 */
exports.getTeam = async function (req, res) {
  const id = req.params.id;

  try {
    utility.validate(id);
    const teamData = await teams.getById({ id });
    const team = teamData?.[0]?.toObject();
    const data = team && {
        ...team,
        _id: team._id,
        first_member_name: team.members?.[0]?.first_name ? `${team.members?.[0]?.first_name} ${team.members?.[0]?.last_name}` : team.members?.[0]?.name,
        team_members: team.members?.map(team => team.first_name ? `${team.first_name} ${team.last_name}` : team.name),
        assignment_method: team.method,
      }
    return res.status(200).send({ data: data });
  } catch (err) {
    return res.status(400).send({ error: err.message });
  }
};

/*
 * event.getEventChats()
 */
exports.getEventChats = async (req, res) => {
  try {
    const eventId = req.params.eventId;

    const matches = await ConfirmedMatch.getEventChats({eventId})

    const result = matches.map(m => ({
      user_1: !m.user_1?.first_name ? m.user_1?.name : `${m.user_1?.first_name} ${m.user_1?.last_name}`,
      user_2: !m.user_2?.first_name ? m.user_2?.name : `${m.user_2?.first_name} ${m.user_2?.last_name}`,
      last_message_by: m.last_message_by ?
        (m.user_1?._id.toString() === m.last_message_by ? !m.user_1?.first_name ? m.user_1?.name : `${m.user_1?.first_name} ${m.user_1?.last_name}`
        : !m.user_2?.first_name ? m.user_2?.name : `${m.user_2?.first_name} ${m.user_2?.last_name}`) : '-',
      last_message_time: m.last_message_time || null,
      status: m.status,
      _id: m._id
    }));

    return res.status(200).send({ data: result });
  } catch (err) {
    console.error('Failed to get event chats:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/*
 * event.archiveChat()
 */
exports.archiveChat = async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const isArchive = req.body.isArchive || false;

    const chat = await ConfirmedMatch.archiveChat({chatId: new mongoose.Types.ObjectId(chatId), isArchive})

    return res.status(200).send({ data: true });
  } catch (err) {
    console.error('Failed to get event chats:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
