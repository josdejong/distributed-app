
var dapp = require('./../distributed-app.js');
var calculator = dapp.getObject('calculator');

var Statistics = function () {};

Statistics.prototype.avg = function (values, callback) {
    var num = values.length;
    var expr = '(' + values.join('+') + ')' + '/' + num;

    calculator.eval(expr, function (err, result) {
        console.log('statistics.avg(' + values + ')=' + result);
        callback(err, result);
    });
};

// exports
module.exports = Statistics;
