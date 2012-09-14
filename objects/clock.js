
var Clock = function () {
    this.time = new Date();

    var me = this;
    setInterval(function () {
        me.time = new Date();
        console.log('clock says: the time is ' + me.time.toISOString());
    }, 5000);
};

// exports
module.exports = Clock;
