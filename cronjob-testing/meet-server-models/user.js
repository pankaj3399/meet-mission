const {schema: User} = require("../../model/mongo/user");
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

async function create({ user, default_account }){
  console.log("user created called.");
  const data = {
    id: uuidv4(),
    name: escape(user.name),
    email: user.email,
    date_created: new Date(),
    last_active: new Date(),
    support_enabled: false,
    '2fa_enabled': false,
    facebook_id: user.facebook_id,
    twitter_id: user.twitter_id,
    ...user.account && { account: user.account },
    ...user.onboarded && { onboarded: user.onboarded },
    ...user.step && { step: user.step },
    ...user.first_name && { account: user.first_name },
    ...user.last_name && { account: user.last_name },
    default_account ,
    avatar: user.avatar,
    verified: user.verified,
    is_invited: user.is_invited,
    gender: user.gender,
    date_of_birth: user.date_of_birth,
    looking_for: user.looking_for,
    relationship_goal: user.relationship_goal,
    children: user.children,
    kind_of_person: user.kind_of_person,
    feel_around_new_people: user.feel_around_new_people,
    prefer_spending_time: user.prefer_spending_time,
    describe_you_better: user.describe_you_better,
    describe_role_in_relationship: user.describe_role_in_relationship
  };

  // encrypt password
  if (user.password){

    const salt = await bcrypt.genSalt(10);
    data.password = await bcrypt.hash(user.password, salt);

  }

  const newUser = new User(data);
  await newUser.save();

  if (data.password){

    delete data.password;
    data.has_password = true;

  }

  data.account_id = default_account ;
  return {...newUser?.toObject(), ...data};

}

module.exports = {
  create,
}
