const {schema: Transaction} = require("../../model/transaction")
const { v4: uuidv4 } = require('uuid');

/*
* transaction.create()
*/
async function create(transaction, session) {
  const data = new Transaction({
    user_id: transaction.user_id,
    ...transaction.participant_id && {participant_id: transaction.participant_id},
    ...transaction.sub_participant_id && {sub_participant_id: transaction.sub_participant_id},
    ...transaction.invited_user_id && {invited_user_id: transaction.invited_user_id},
    type: transaction.type,
    amount: transaction.amount,
    ...transaction.event_id && {event_id: transaction.event_id},
    ...transaction.quantity && {quantity: transaction.quantity},
    status: transaction.status || 'unpaid'
  });
  await data.save({
    session: session ? session : null
  });
  return data;
};

module.exports = {
  create
}
