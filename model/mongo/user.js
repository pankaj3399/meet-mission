const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// define schema
const UserSchema = new Schema({

  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String },
  date_created: Date,
  last_active: Date,
  disabled: { type: Boolean },
  support_enabled: { type: Boolean, required: true },
  '2fa_enabled': { type: Boolean, required: true },
  '2fa_secret': { type: String, required: false },
  '2fa_backup_code': { type: String, required: false },
  default_account: { type: String, required: true },
  facebook_id: { type: String },
  twitter_id: { type: String },
  account: { type: Array },
  dark_mode: { type: Boolean },
  verified: { type: Boolean, required: true }

});

// from meet-server... just for cron job testing purposes.
const UserSchema2 = new Schema({

  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String },
  date_created: Date,
  last_active: Date,
  disabled: { type: Boolean },
  support_enabled: { type: Boolean, required: true },
  '2fa_enabled': { type: Boolean, required: true },
  '2fa_secret': { type: String, required: false },
  '2fa_backup_code': { type: String, required: false },
  default_account: { type: String },
  facebook_id: { type: String },
  twitter_id: { type: String },
  account: { type: Array },
  push_token: { type: String },
  avatar: { type: String },
  dark_mode: { type: Boolean },
  verified: { type: Boolean, required: true },
  step: { type: Number, default: 1 },
  onboarded: { type: Boolean, default: false },
  first_name: { type: String },
  last_name: { type: String },
  gender: { type: String, enum: ['male', 'female', 'diverse'], default: null },
  date_of_birth: { type: Date },
  interests: [{ type: String }],
  looking_for: { type: String },
  profession: { type: String },
  smoking_status: { type: Boolean, default: null },
  description: { type: String },
  images: [{ type: String }],
  is_invited: { type: Boolean, default: null },
  locale: { type: String, default: 'de' },
  relationship_goal: { type: String, default: null },
  children: { type: Boolean, default: null },
  kind_of_person: { type: String, default: null },
  feel_around_new_people: { type: String, default: null },
  prefer_spending_time: { type: String, default: null },
  describe_you_better: { type: String, default: null },
  describe_role_in_relationship: { type: String, default: null },
});

const User = mongoose.model('User', UserSchema2, 'user');
exports.schema = User;

/*
* user.create()
* create a new user
*/

exports.create = async function({ user, account }){

  const data = {

    id: uuidv4(),
    name: user.name,
    email: user.email,
    date_created: new Date(),
    last_active: new Date(),
    support_enabled: false,
    '2fa_enabled': false,
    facebook_id: user.facebook_id,
    twitter_id: user.twitter_id,
    default_account: account,
    verified: user.verified

  }

  // encrypt password
  if (user.password){

    const salt = await bcrypt.genSalt(10);
    data.password = await bcrypt.hash(user.password, salt);

  }

  const newUser = User(data);
  await newUser.save();

  if (data.password){

    delete data.password;
    data.has_password = true;

  }

  data.account_id = account;
  return data;

}

/*
* user.get()
* get a user by email or user id
*/

exports.get = async function({ id, email } = {}){

  const data = await User.find({

    ...id && { 'id': id },
    ...email && { 'email': email },

  }).select({ _id: 0, __v: 0, password: 0, });

  if (data?.length){
    data.forEach(u => {

      u.avatar = u.avatar ?
        `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com/${u.avatar}` : null

    })
  }

  return data;
}

/*
* user.update()
* update the user profile
* profile: object containing the user data to be saved
*/


exports.update = async function({ id, data }){

  await User.findOneAndUpdate({ id: id }, data);
  return data;

}

exports.account = {};

/*
* user.account.add()
* assign a user to an account
*/

exports.account.add = async function({ id, account, permission }){

  const data = await User.findOne({ id: id });

  if (data){

    data.account.push({ id: account, permission: permission, onboarded: false });
    data.markModified('account');
    return await data.save();

  }

  throw { message: `No user with that ID` };

}

/*
* user.delete()
* delete a user
*/


exports.delete = async function(id){

  return await User.findOneAndRemove({ id: id });

};
