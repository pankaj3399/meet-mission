const { schema: Account } = require("../../model/account");
const { v4: uuidv4 } = require('uuid');

/*
* account.create()
* create a new account and return the account id
*/

async function create({ plan } = {}){

  const data = new Account({

    id: uuidv4(),
    name: 'Tested for cronjob.',
    active: true,
    date_created: new Date(),

  });

  const newAccount = new Account(data);
  await newAccount.save();
  return data;

}


module.exports = {
  create
}
