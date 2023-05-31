const RealestateComAu = require('./RealestateComAu');
const express = require('express');

const app = express();
app.get('/', (req, res) => {
const realestate = new RealestateComAu();
const searchParams = {
  limit: 10,
  start_page: 1,
  channel: 'rent',
  locations: ['Sydney', 'Melbourne'],
  min_price: 50,
  max_price: 1000,
  min_bedrooms: 2,
  max_bedrooms: 4
};

realestate.search(searchParams)
  .then(listings => {
    res.send(listings);
  })
  .catch(error => {
    console.error('Error occurred while searching:', error);
  });
})
const server = app.listen(443);