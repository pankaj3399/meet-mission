// const joi = require('joi');
const openai = require("../model/openai");
const account = require("../model/account");
const utility = require("../helper/utility");
const mail = require("../helper/mail");
const eventModel = require("../model/event-management");
const transaction = require("../model/transaction");
const participants = require("../model/registered-participant");
const confirmMatchModel = require("../model/confirm-match");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const groupModel = require("../model/group");
const teamModel = require("../model/team");
const i18n = require("i18n");
const stripe = require("../model/stripe");
const moment = require("moment-timezone");
const { formTeams, summarizeSlots } = require("../helper/finalTeamBuilder");
const {
  buildGroupsAndRoundsByAge,
  verifyGroups,
  dedupeBalanceReport,
  checkBarCapacities,
} = require("../helper/teamHelper2");

exports.generateTeamGroup = async function () {
  const events = await eventModel.getEventCron({ day: 3, generated: false });
  // console.log("events: ", JSON.stringify(events));

  if (events?.length) {
    const handleGroupTeams = await Promise.all(
      events.map(async (event) => {
        const registeredParticipants = await transaction.getParticipantsCron({
          event_id: new mongoose.Types.ObjectId(event._id),
        });
        
        // for testing
        // console.log("============================================");
        // console.log("============================================");
        // console.log("bars: ", JSON.stringify(event.bars));
        // console.log("============================================");
        // console.log("============================================");
        // console.log(
        //   "registeredParticipants: ",
        //   JSON.stringify(registeredParticipants)
        // );
        
        // for testing
        // const simplifiedparticipants = registeredParticipants.map((p) => {
        //   return {
        //     name: p.name || `${p.first_name} ${p.last_name}`.trim(),
        //     gender: p.gender,
        //     age: p.age,
        //     is_solo: !p.invited_user_id // true if no invited_user_id
        //   };
        // })
        // console.log(JSON.stringify(simplifiedparticipants), 'participants');
        // console.log(JSON.stringify(event.bars), 'events.bars');
        if (registeredParticipants?.length) {
          const { teams, notes: teamNotes } = formTeams({
            participants: registeredParticipants,
          });
          // console.log("TEAMS:", JSON.stringify(teams));

          // const simplifiedTeams = teams.map(team => ({
          //   team_name: team.team_name,
          //   age_group: team.age_group,
          //   members: team.members.map(m => `${m.first_name} ${m.last_name}`)
          // }));
          // console.log("TEAMS:", JSON.stringify(simplifiedTeams));
          // console.log("TEAM NOTES:", JSON.stringify(teamNotes));
          // console.log("===========================");
          const {
            groupsAndRounds,
            notes,
            cancelledByRound: cancelledTeams,
          } = buildGroupsAndRoundsByAge(teams, event.bars);
          // console.log(JSON.stringify(groupsAndRounds), 'GROUP');
          // const simplified = {};

          // Object.entries(groupsAndRounds).forEach(([ageGroup, slots]) => {
          //   Object.entries(slots).forEach(([slotKey, slotArray]) => {
          //     if (!simplified[slotKey]) simplified[slotKey] = []; // init slot container

          //     slotArray.forEach((slotItem) => {
          //       slotItem.groups.forEach((group, groupIndex) => {
          //         simplified[slotKey].push({
          //           group_name: `Group ${slotKey}-${groupIndex + 1}`,
          //           teams: group.map((team) => team.team_name),
          //           age_group: ageGroup
          //         });
          //       });
          //     });
          //   });
          // });

          // console.log(JSON.stringify(simplified), 'GROUP');
          // console.log(JSON.stringify(notes), 'GROUP note');
          // const simplifiedCancelledTeams = Object.entries(cancelledTeams).map(([ageGroup, groupData]) => ({
          //   age_group: ageGroup,
          //   teams: groupData.all.map(team => ({
          //     team_name: team.team_name,
          //     members: team.members.map(m => `${m.first_name} ${m.last_name}`)
          //   }))
          // }));

          // console.log(JSON.stringify(simplifiedCancelledTeams), 'cancelled teams');
          // console.log(JSON.stringify(cancelledTeams), 'GROUP cancelledTeams');

          // Check for a hard scheduling failure from the validator.
          const hardFailureNote = notes.find((note) =>
            note.startsWith("Scheduling failed")
          );

          if (hardFailureNote) {
            console.error(
              `CRITICAL: Could not generate schedule for event ${event._id}. Reason: ${hardFailureNote}`
            );

            let message = `Hello admin,\n\n\n\n❌ A critical error occurred while generating the schedule for event: ${event.tagline}.\n\n`;
            message += `The process was halted because the event's setup is invalid.\n\n`;
            message += `Error Details: ${hardFailureNote}\n\n`;
            message += `Please correct the event's configuration (e.g., add more bars) in the admin panel. No groups or teams have been saved for the affected age group.\n`;

            const adminAccounts = await mongoose
              .model("Account")
              .find({ name: "Master", active: true })
              .select("id")
              .lean();
            const adminUserIds = adminAccounts.map((account) => account.id);
            const adminUsers = await mongoose
              .model("User")
              .find({ default_account: { $in: adminUserIds } })
              .select("email name")
              .lean();
            for (const adminUser of adminUsers) {
              await mail.send({
                to: adminUser.email,
                locale: "en",
                template: "template",
                subject: `URGENT ACTION REQUIRED: Event Setup Invalid for ${event.tagline}`,
                content: {
                  body: message,
                  closing: "Best Regards,",
                  button: {
                    url: process.env.MISSION_CONTROL_CLIENT,
                    label: "Go to Admin App",
                  },
                },
              });
            }

            // IMPORTANT: Stop processing for this event and move to the next one.
            return {
              message: `Event ${event._id} failed validation. Process halted.`,
            };
          }

          const check = verifyGroups(groupsAndRounds);

          // console.log("Errors:", check.errors);
          const deficits = checkBarCapacities(groupsAndRounds, event.bars);

          // console.log(JSON.stringify(deficits), 'deficits');
          if (!teams?.length) {
            return { message: "No teams created." };
          }

          // 2. Save all teams and keep ID mapping
          const teamMap = new Map();

          const savedTeams = await Promise.all(
            teams.map(async (team) => {
              const saved = await teamModel.add({
                team: { ...team },
                eventId: event._id,
              });
              teamMap.set(team.team_name, saved._id);
              return saved;
            })
          );

          // 3. Save all groups with round + bar info
          for (const [ageGroup, rounds] of Object.entries(groupsAndRounds)) {
            for (const [roundKey, bars] of Object.entries(rounds)) {
              for (const bar of bars) {
                const groups = bar.groups || [];

                for (const [groupIndex, group] of groups.entries()) {

                  const team_ids = group.map((t) => teamMap.get(t.team_name));

                  await groupModel.add({
                    group: {
                      group_name: `Round${roundKey}-Group${groupIndex + 1}`, // unique name
                      slot: roundKey, // or whatever "slot" means in your schema
                      teams: group, // snapshot of team objects
                      team_ids, // db ids of teams
                      bar_id: bar.bar_id,
                      age_group: ageGroup,
                    },
                    eventId: event._id,
                  });
                }
              }
            }
          }

          // 4. Handle cancellations (send email + optionally persist)
          if (Object.keys(cancelledTeams).length > 0) {
            for (const [ageGroup, data] of Object.entries(cancelledTeams)) {
              for (const team of data.teams) {
                for (const member of team.members) {
                  // console.log(
                  //   member,
                  //   team.team_name,
                  //   ageGroup,
                  //   "cancelled team"
                  // );
                  const redeemBy = Math.floor(
                    moment().add(24, "months").valueOf() / 1000
                  );

                  // Cancel registration
                  await mongoose.model("RegisteredParticipant").updateMany(
                    {
                      user_id: new mongoose.Types.ObjectId(member.user_id),
                      event_id: new mongoose.Types.ObjectId(event._id),
                    },
                    {
                      $set: {
                        status: "canceled",
                        is_cancelled: true,
                        cancel_date: new Date(),
                      },
                    }
                  );

                  // Calculate amount user actually paid
                  const txDocs = await mongoose
                    .model("Transaction")
                    .find({
                      user_id: new mongoose.Types.ObjectId(member.user_id),
                      event_id: new mongoose.Types.ObjectId(event._id),
                      status: "paid",
                      type: "Register Event",
                    })
                    .lean();

                  if (txDocs.length === 0) continue; // TODO: remove this later.

                  const amountOffCents = Math.round(
                    (txDocs || []).reduce(
                      (sum, t) =>
                        sum +
                        (typeof t.amount === "number" ? t.amount * 100 : 0),
                      0
                    )
                  );

                  if (!amountOffCents)
                    throw new Error("No paid transaction found for this user");

                  // Create coupon and promotion code (single-use)
                  const coupon = await stripe.coupon.createOnce({
                    amount_off: amountOffCents,
                    currency: "eur",
                    redeem_by: redeemBy,
                    name: `Voucher - ${event.tagline}`.substring(0, 40),
                    metadata: {
                      user_id: String(member.user_id),
                      event_id: String(event._id),
                      reason: "admin_event_cancellation",
                    },
                  });
                  const code = `MEET-${Math.random()
                    .toString(36)
                    .substring(2, 10)
                    .toUpperCase()}`;
                  const promo = await stripe.promotionCode.create({
                    coupon: coupon.id,
                    code,
                    expires_at: redeemBy,
                    max_redemptions: 1,
                    metadata: {
                      user_id: String(member.user_id),
                      event_id: String(event._id),
                      coupon_id: coupon.id,
                    },
                  });

                  // Email user with voucher code
                  await mail.send({
                    to: member.email,
                    locale: "de",
                    custom: true,
                    template: "event_cancelled",
                    subject: i18n.__("payment.cancelled_event_admin.subject", {
                      city: event.city?.name,
                    }),
                    content: {
                      name: `${member.first_name} ${member.last_name}`,
                      body: i18n.__("payment.cancelled_event_admin.body", {
                        event: event.tagline,
                        code: promo.code,
                        date: moment.unix(redeemBy).format("YYYY-MM-DD"),
                      }),
                      button_url: process.env.CLIENT_URL,
                      button_label: i18n.__(
                        "payment.cancelled_event_admin.button"
                      ),
                      closing: i18n.__("payment.cancelled_event_admin.closing"),
                    },
                  });
                }
              }
            }
          }

          if (
            deficits?.deficits &&
            Object.keys(deficits?.deficits).length > 0
          ) {
            let message =
              "Hello admin,\n\n\n\n⚠️ Bar capacity deficits detected:\n\n";
            for (const [barId, info] of Object.entries(deficits?.deficits)) {
              message += `Bar ${info.name} exceeded capacity in Round ${info.peakRound}\n`;
              message += `- Assigned: ${info.peakAssigned}\n`;
              message += `- Available: ${info.available}\n`;
              message += `- Extra Seats Needed: ${info.needed}\n`;
              message += `- Breakdown: ${JSON.stringify(info.breakdown)}\n\n`;
            }

            const adminAccounts = await mongoose
              .model("Account")
              .find({
                name: "Master",
                active: true,
              })
              .select("id")
              .lean();

            const adminUserIds = adminAccounts.map((account) => account.id);
            const adminUsers = await mongoose
              .model("User")
              .find({
                default_account: { $in: adminUserIds },
              })
              .select("email name")
              .lean();
            for (const adminUser of adminUsers) {
              await mail.send({
                to: adminUser.email,
                locale: "en",
                template: "template",
                subject: `${event.city.name} - ${event.tagline} locations need attention!`,
                content: {
                  body: message,
                  closing: "Best Regards,",
                  button: {
                    url: process.env.MISSION_CONTROL_CLIENT,
                    label: "Admin App",
                  },
                },
              });
            }
          }

          // update event
          await eventModel.update({
            id: new mongoose.Types.ObjectId(event._id),
            data: {
              has_grouped_by_ai: true,
            },
          });

          return { message: "All teams and groups saved successfully." };
        }
      })
    );
  }

  return events;
};

exports.eventStartReminder = async function () {
  const events = await eventModel.getEventCron({ day: 1, generated: true });
  if (events?.length) {
    const handleGroupTeams = await Promise.all(
      events.map(async (event) => {
        const registeredParticipants = await participants.getRegistered({
          event_id: new mongoose.Types.ObjectId(event._id),
          isValid: true,
        });
        // console.log(registeredParticipants, 'registration');
        registeredParticipants &&
          (await Promise.all(
            registeredParticipants.map(async (reg) => {
              const team = await teamModel.getByUserId({ id: reg.user_id });
              // console.log(team, 'team');
              if (team) {
                const group = await groupModel.getByTeamId({ id: team._id });
                // console.log(group, 'group');
                if (group?.length) {
                  const sortedGroups = group
                    .sort((a, b) => a.slot - b.slot) // sort by slot ascending
                    .map((group) => ({
                      slot: group.slot,
                      group_name: group.group_name,
                      bar_name: group.bar_id.name,
                      bar_address: group.bar_id.address,
                    }));

                  // console.log(sortedGroups, event, 'sort');

                  const emailData = {
                    name: `${reg.first_name}`,
                    date: event.date && utility.formatDateString(event.date),
                    email: reg.email,
                    city: event.city.name,
                    start_time: event.start_time,
                    end_time: event.end_time,
                    tagline: event.tagline,
                    team_partners: team.members
                      .map((member) =>
                        member.first_name
                          ? `${member.first_name} ${member.last_name}`
                          : member.name
                      )
                      ?.join(", "),
                    age_group: team.age_group,
                    groups: sortedGroups,
                  };

                  const formatTime = (date) =>
                    date.toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    });

                  const slotDurationMinutes = 90;

                  // Combine date and time into a single Date object
                  const [day, month, year] = emailData.date.split(".");
                  const [hour, minute] = emailData.start_time.split(":");
                  const eventStart = new Date(
                    Number(year),
                    Number(month) - 1,
                    Number(day),
                    Number(hour),
                    Number(minute)
                  );

                  const groupString = emailData.groups
                    ?.map((dt, idx) => {
                      const slotStart = new Date(
                        eventStart.getTime() + idx * slotDurationMinutes * 60000
                      );
                      if (idx > 0)
                        slotStart.setSeconds(slotStart.getSeconds() + 1);
                      const slotEnd = new Date(
                        slotStart.getTime() + slotDurationMinutes * 60000
                      );
                      if (idx > 0) slotEnd.setSeconds(slotEnd.getSeconds() - 1);

                      return i18n.__("job.reminder_event.group", {
                        index: dt.slot,
                        slotStartTime: formatTime(slotStart),
                        slotEndTime: formatTime(slotEnd),
                        barName: dt.bar_name,
                        barAddress: dt.bar_address,
                      });
                    })
                    ?.join("");

                  const eventDate = new Date(
                    Number(year),
                    Number(month) - 1,
                    Number(day)
                  );

                  // Add 4 weeks (28 days) to get endTime
                  const endDate = new Date(eventDate);
                  endDate.setDate(endDate.getDate() + 28);
                  // Format endTime as 'dd.mm.yyyy'
                  const endTime = endDate.toLocaleDateString("en-GB"); // Outputs in 'dd/mm/yyyy'
                  const endTimeFormatted = endTime.replace(/\//g, "."); // Convert to 'dd.mm.yyyy'

                  const body = i18n.__("job.reminder_event.body", {
                    participantFirstName: emailData.name,
                    eventDateFormatted: emailData.date,
                    cityName: emailData.city,
                    startTime: emailData.start_time,
                    endTime: endTimeFormatted,
                    eventTagline: emailData.tagline,
                    teamPartnerName: emailData.team_partners,
                    ageGroup: emailData.age_group,
                    group: groupString,
                    matchingPhaseTime: "12:00",
                  });

                  await mail.send({
                    to: emailData.email,
                    locale: reg.locale || "de",
                    template: "template",
                    subject: i18n.__("job.reminder_event.subject"),
                    content: {
                      body,
                      closing: i18n.__("job.reminder_event.closing"),
                      button: {
                        url: process.env.CLIENT_URL,
                        label: i18n.__("job.reminder_event.button"),
                      },
                    },
                  });
                  // console.log(emailData, body, 'emailData');
                }
              }
            })
          ));
      })
    );
  }
  return events;
};

exports.swipeEventStartReminder = async function () {
  const events = await eventModel.getSwipeEventCron({ generated: true });
  if (events?.length) {
    const handleGroupTeams = await Promise.all(
      events.map(async (event) => {
        const registeredParticipants = await participants.getRegistered({
          event_id: new mongoose.Types.ObjectId(event._id),
          isValid: true,
        });
        // console.log(registeredParticipants, 'registration');
        registeredParticipants &&
          (await Promise.all(
            registeredParticipants.map(async (reg) => {
              const team = await teamModel.getByUserId({ id: reg.user_id });
              if (team) {
                const group = await groupModel.getByTeamId({ id: team._id });
                if (group?.length) {
                  const emailData = {
                    name: `${reg.first_name}`,
                    date: event.date && utility.formatDateString(event.date),
                    email: reg.email,
                    city: event.city.name,
                    start_time: event.start_time,
                    end_time: event.end_time,
                  };
                  // Combine date and time into a single Date object
                  const [day, month, year] = emailData.date.split(".");
                  const eventDate = new Date(
                    Number(year),
                    Number(month) - 1,
                    Number(day)
                  );

                  // Add 4 weeks (28 days) to get endTime
                  const endDate = new Date(eventDate);
                  endDate.setDate(endDate.getDate() + 28);
                  // Format endTime as 'dd.mm.yyyy'
                  const endTime = endDate.toLocaleDateString("en-GB"); // Outputs in 'dd/mm/yyyy'

                  const body = i18n.__("job.reminder_event_swipe.body", {
                    participantFirstName: emailData.name,
                    eventDateFormatted: emailData.date,
                    city: emailData.city,
                  });

                  await mail.send({
                    to: emailData.email,
                    locale: reg.locale || "de",
                    template: "template",
                    subject: i18n.__("job.reminder_event_swipe.subject"),
                    content: {
                      body,
                      closing: i18n.__("job.reminder_event_swipe.closing"),
                      button: {
                        url: process.env.CLIENT_URL,
                        label: i18n.__("job.reminder_event_swipe.button"),
                      },
                    },
                  });
                  // console.log(emailData, body, 'emailData');
                }
              }
            })
          ));
      })
    );
  }
  return events;
};

exports.eventEndReminder = async function () {
  const events = await eventModel.getEndEventCron({ generated: true });
  // console.log(events, "events");

  if (events?.length) {
    const handleGroupTeams = await Promise.all(
      events.map(async (event) => {
        const registeredParticipants = await participants.getRegistered({
          event_id: new mongoose.Types.ObjectId(event._id),
          isValid: true,
        });
        registeredParticipants &&
          (await Promise.all(
            registeredParticipants.map(async (reg) => {
              const team = await teamModel.getByUserId({ id: reg.user_id });
              if (team) {
                const group = await groupModel.getByTeamId({ id: team._id });
                const hasConfirmedMatch =
                  await confirmMatchModel.hasConfirmedMatch({
                    eventId: new mongoose.Types.ObjectId(event._id),
                    userId: new mongoose.Types.ObjectId(reg.user_id),
                  });

                if (group?.length && !hasConfirmedMatch) {
                  const emailData = {
                    name: `${reg.first_name}`,
                    date: event.date && utility.formatDateString(event.date),
                    email: reg.email,
                    city: event.city.name,
                    start_time: event.start_time,
                    end_time: event.end_time,
                  };

                  const body = i18n.__("job.reminder_event_end.body", {
                    participantFirstName: emailData.name,
                    eventDateFormatted: emailData.date,
                    city: emailData.city,
                  });

                  await mail.send({
                    to: emailData.email,
                    locale: reg.locale || "de",
                    template: "template",
                    subject: i18n.__("job.reminder_event_end.subject"),
                    content: {
                      body,
                      closing: i18n.__("job.reminder_event_end.closing"),
                      button: {
                        url: process.env.CLIENT_URL,
                        label: i18n.__("job.reminder_event_end.button"),
                      },
                    },
                  });
                  // console.log(emailData, body, 'emailData');
                }
              }
            })
          ));
      })
    );
  }
  return events;
};
