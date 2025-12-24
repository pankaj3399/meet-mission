const {schema: RegisteredParticipant} = require("../../model/registered-participant")
const { v4: uuidv4 } = require('uuid');

/*
 * registeredParticipant.create()
 */
async function create(registration, session) {
  const data = new RegisteredParticipant({
    user_id: registration.user_id,
    event_id: registration.event_id,
    first_name: registration.first_name,
    last_name: registration.last_name,
    gender: registration.gender || null,
    date_of_birth: registration.date_of_birth,
    age_group: registration.age_group,
    email: registration.email,
    status: registration.status || 'registered',
    is_main_user: registration.is_main_user,
    looking_for: registration.looking_for,
    relationship_goal: registration.relationship_goal,
    children: registration.children,
    kind_of_person: registration.kind_of_person,
    feel_around_new_people: registration.feel_around_new_people,
    prefer_spending_time: registration.prefer_spending_time,
    describe_you_better: registration.describe_you_better,
    describe_role_in_relationship: registration.describe_role_in_relationship,
    is_test: registration.is_test
  });

  await data.save({
    session: session ? session : null
  });
  return data;
};

module.exports = {
  create
}
