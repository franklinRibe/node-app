var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.get('/passcode', function(req, res, next) {
  res.send({pin: 1234});
});

module.exports = router;
