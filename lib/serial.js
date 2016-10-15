var util =              require('util');
var EventEmitter =      require('events').EventEmitter;

function Serial(options, log, onCreated) {
    if (!(this instanceof Serial)) return new Serial(options, log, onCreated);
    this._interface = null;
    this.serialConnected = false;

    var lastMessageTs;
    var serialport;
    var that = this;

    options = options || {};
    options.connTimeout = (options.connTimeout !== undefined) ? 60000 : parseInt(options.connTimeout, 10) || 0;

    function openSerial() {
        // serial;
        try {
            serialport = serialport || require('serialport');//.SerialPort;
        } catch (e) {
            console.warn('Serial port is not available');
        }
        if (serialport) {
            var portConfig = {baudRate: options.baudRate || 115200, parser: serialport.parsers.readline('\n')};
            var SerialPort = serialport.SerialPort;

            if (options.comName) {
                try {
                    that._interface = new SerialPort(options.comName, portConfig, false);
                    that._interface.on('error', function (error) {
                        log.error('Failed to use serial port: ' + error);
                    });
                    that._interface.open(function (error) {
                        if (error) {
                            log.error('Failed to open serial port: ' + error);
                        } else {
                            log.info('Serial port opened');
                            // forward data
                            that._interface.on('data', function (data) {
                                data = data.toString();

                                // Do not reset timeout too often
                                if (options.connTimeout && (!lastMessageTs || new Date().getTime() - lastMessageTs > 5000)) {
                                    if (that.disconnectTimeout) clearTimeout(that.disconnectTimeout);
                                    that.disconnectTimeout = setTimeout(that.disconnected.bind(that), options.connTimeout);
                                }

                                lastMessageTs = new Date().getTime();

                                if (!that.serialConnected) {
                                    if (log) log.info('Connected');
                                    that.serialConnected = true;
                                    that.emit('connectionChange', true);
                                }

                                if (data.split(';').length < 3) {
                                    if (log) log.warn('Wrong serial data: ' + data);
                                } else {
                                    if (log) log.debug('Serial data received: ' + data);
                                    that.emit('data', data);
                                }
                            }.bind(that));

                            that._interface.on('error', function (err) {
                                if (log && err) log.error('Serial error: ' + err);
                            });
                            if (onCreated) onCreated();
                        }
                    }.bind(that));
                } catch (e) {
                    if (log) log.error('Cannot open serial port "' + options.comName + '": ' + e);
                    that._interface = null;
                }
            } else {
                if (log) log.error('No serial port defined');
            }
        }
    }

    openSerial();

    this.write = function (data, callback) {
        if (this._interface) {
            if (log) log.debug('Send raw data: ' + data);
            //serial
            try {
                this._interface.write(data + '\n', function (error) {
                    if (log && error) {
                        log.error('Cannot send: ' + error);
                        that._interface.pause();
                        that._interface.close();
                        that._interface = null;
                        that.disconnected();
                        if (callback) {
                            callback('Cannot send_: ' + error);
                            callback = null;
                        } else {
                            if (log) log.warn('Cannot send_: ' + error);
                        }
                        setTimeout(function () {
                            openSerial();
                        }, 500);
                    } else {
                        if (callback) {
                            callback();
                            callback = null;
                        }
                    }
                });
            } catch (error) {
                this._interface.pause();
                this._interface.close();
                this._interface = null;
                this.disconnected();
                if (callback) {
                    callback('Cannot send_: ' + error);
                    callback = null;
                } else {
                    if (log) log.warn('Cannot send_: ' + error);
                }

                setTimeout(function () {
                    openSerial();
                }, 1000);
            }
        } else {
            if (callback) {
                callback('Serial not opened');
                callback = null;
            } else {
                if (log) log.warn('Serial not opened');
            }
        }
    };

    this.isConnected = function () {
        return this.serialConnected;
    };

    this.disconnected = function () {
        if (this.serialConnected) {
            if (log) log.info('disconnected');
            this.serialConnected = false;
            this.emit('connectionChange', false);
            // stop timer
            if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);
            this.disconnectTimeout = null;
        }
    };

    this.destroy = function () {
        if (this._interface && this._interface.isOpen()) {
            //serial
            this._interface.close();
        }
        this._interface = null;
    };

    return this;
}

// extend the EventEmitter class using our Radio class
util.inherits(Serial, EventEmitter);

module.exports = Serial;