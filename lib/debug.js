var util         = require('util');
var EventEmitter = require('events').EventEmitter;
var fs           = require('fs');

function SerialDebug(options, log, onCreated) {
    if (!(this instanceof SerialDebug)) return new SerialDebug(options, log, onCreated);

    var that = this;

    log.debug('Options: ' + JSON.stringify(options))
    options = options || {};
    options.fileName  = options.fileName || __dirname + '/../test/lib/commands.txt';
    options.intervall = parseInt(options.intervall, 10) || 200;

    function sendLines(lines, callback) {
        if (!lines || !lines.length) {
            if (callback) callback ();
            return;
        }
        var data = lines.shift();
        // if stop
        if (data.indexOf('---') !== -1){
            if (callback) callback ();
            return;
        }

        if (!data || data.split(';').length < 3 || data[0] === '#') {
            if (log) log.warn('Wrong serial data: ' + data);
            return sendLines(lines, callback);
        } else {
            if (log) log.debug('Serial data received: ' + data);
            that.emit('data', data);
        }

        setTimeout(function () {
            sendLines(lines, callback);
        }, options.intervall);
    }
    // simulate port open
    setTimeout(function () {
        if (onCreated) onCreated();

        that.emit('connectionChange', true);

        var lines = fs.readFileSync(options.fileName);
        lines = lines.toString().split('\n');
        sendLines(lines);
    }, options.intervall);

    this.write = function (data, callback) {
        if (callback) callback('Not implemented');
    };

    this.isConnected = function () {
        return true;
    };

    this.destroy = function () {

    };

    return this;
}

// extend the EventEmitter class using our EventEmitter class
util.inherits(SerialDebug, EventEmitter);

module.exports = SerialDebug;
