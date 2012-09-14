/**
 * module calculator
 */
var Calculator = function () {
    this.delay = 0;  // to simulate a slow response
    this.incrementValue = 0;
};

/**
 * Add a and b
 * @param {Number} a
 * @param {Number} b
 * @param {function} callback  Called with parameters (err, result)
 */
Calculator.prototype.add = function(a, b, callback) {
    setTimeout(function () {
        var result = a + b;
        console.log('calculator.add(' + a + ', ' + b + ')=' + result);
        callback(null, result);
    }, this.delay);
};

/**
 * Multiply a with b
 * @param {Number} a
 * @param {Number} b
 * @param {function} callback  Called with parameters (err, result)
 */
Calculator.prototype.multiply = function(a, b, callback) {
    setTimeout(function () {
        var result = a * b;
        console.log('calculator.multiply(' + a + ', ' + b + ')=' + result);
        callback(null, result);
    }, this.delay);
};

/**
 * Evaluate a javascript expression
 * @param {String} expr
 * @param {function} callback
 */
Calculator.prototype.eval = function (expr, callback) {
    try {
        var result = eval(expr);
        console.log('calculator.eval("' + expr + '")=' + result);
        callback(null, result);
    }
    catch (err) {
        callback(err, null);
    }
};

/**
 * increment the internal counter
 * @param {function} callback  Called with parameters (err, result)
 */
Calculator.prototype.increment = function (callback) {
    var self = this;
    setTimeout(function () {
        self.incrementValue++;
        console.log('calculator.increment()=' + self.incrementValue);
        callback(null, self.incrementValue);
    }, this.delay);
};

// exports
module.exports = Calculator;
