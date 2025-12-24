const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// define schema
const AccountSchema = new Schema({

  id: { type: String, required: true, unique: true },
  plan: { type: String },
  name: { type: String },
  active: { type: Boolean, required: true },
  stripe_subscription_id: { type: String },
  stripe_customer_id: { type: String },
  date_created: { type: Date, required: true },
  virtual_currency: { type: Number, default: 0 },
});

const Account = mongoose.model('Account', AccountSchema, 'account');
exports.schema = Account;

/*
* account.create()
* create a new account
*/

exports.create = async function(account){

  const data = Account({

    id: uuidv4(),
    active: true,
    name: account.name || 'My Account',
    plan: account.plan || 'free',
    date_created: new Date(),

  });

  const newAccount = Account(data);
  await newAccount.save();
  return data;

}

/*
* account.get()
* get an account by email or id
*/

exports.get = async function(){

  const data = await Account.aggregate([{
    $lookup: {

      from: 'user',
      localField: 'id',
      foreignField: 'account.id',
      as: 'user',

     }
  }]);

  if (data.length){
    return data.map(a => {

      const owner = a.user.filter(u => {

        return u.account.find(x => x.permission === 'owner' || 'master');

      });

      return {

        id: a.id,
        email: owner?.[0]?.email,
        virtual_currency: a.virtual_currency || 0,
        active: a.active,
        date_created: a.date_created

      }
    });
  }

  return data;

}
