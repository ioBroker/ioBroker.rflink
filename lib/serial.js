'use strict';

const util         = require('util');
const EventEmitter = require('events').EventEmitter;

function Serial(options, log, onCreated) {
    if (!(this instanceof Serial)) {
        return new Serial(options, log, onCreated);
    }

    this._interface = null;
    this._interfaceParser = null;
    this.serialConnected = false;

    let lastMessageTs;
    let serialport;
    const that = this;

    options = options || {};
    options.connTimeout = (options.connTimeout === undefined) ? 60000 : parseInt(options.connTimeout, 10) || 0;

    if (options.connTimeout < 60000) {
        options.connTimeout = 60000;
    }

    function openSerial() {
        // serial;
        try {
            serialport = serialport || require('serialport');//.SerialPort;
        } catch (e) {
            console.warn('Serial port is not available');
        }
        if (serialport) {
            const SerialPort = serialport.SerialPort;

            if (options.comName) {
                try {
                    const portConfig = { path: options.comName, baudRate: parseInt(options.baudRate,10) || 115200, autoOpen: false };
                    that._interface = new SerialPort(portConfig);
                    that._interfaceParser = that._interface.pipe(new serialport.parsers.Readline());
                    that._interface.on('error', error => log.error('Failed to use serial port: ' + error));
                    that._interface.open(error => {
                        if (error) {
                            log.error('Failed to open serial port: ' + error);
                        } else {
                            log.info('Serial port opened');
                            // forward data
                            that._interfaceParser.on('data', data => {
                                data = data.toString();

                                // Do not reset timeout too often
                                if (options.connTimeout && (!lastMessageTs || new Date().getTime() - lastMessageTs > 5000)) {
                                    that.disconnectTimeout && clearTimeout(that.disconnectTimeout);
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
                            });

                            that._interface.on('error', err => log && err && log.error('Serial error: ' + err));
                            onCreated && onCreated();
                        }
                    });
                } catch (e) {
                    if (log) log.error(`Cannot open serial port "${options.comName}": ${e}`);
                    that._interface = null;
                    that._interfaceParser = null;
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
                this._interface.write(data + '\n', error => {
                    if (log && error) {
                        log.error('Cannot send: ' + error);
                        that._interface.pause();
                        that._interface.close();
                        that._interface = null;
                        that._interfaceParser = null;
                        that.disconnected();
                        if (callback) {
                            callback('Cannot send_: ' + error);
                            callback = null;
                        } else {
                            if (log) log.warn('Cannot send_: ' + error);
                        }
                        that.openPortTimeout = that.openPortTimeout || setTimeout(() => {
                            that.openPortTimeout = null;
                            openSerial()
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
                this._interfaceParser = null;
                this.disconnected();
                if (callback) {
                    callback('Cannot send_: ' + error);
                    callback = null;
                } else {
                    if (log) log.warn('Cannot send_: ' + error);
                }

                that.openPortTimeout = that.openPortTimeout || setTimeout(() => {
                    that.openPortTimeout = null;
                    openSerial()
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
            this.disconnectTimeout && clearTimeout(this.disconnectTimeout);
            this.disconnectTimeout = null;

            // reconnect logic if we receive an unexpected disconnect while still have the interface open.
            if (this._interface) {
               this._interface.close();
               this._interface = null;
               this._interfaceParser = null;

                that.openPortTimeout = that.openPortTimeout || setTimeout(() => {
                    that.openPortTimeout = null;
                    openSerial()
                }, 2000);
            }
        }
    };

    this.destroy = function () {
        that.disconnectTimeout && clearTimeout(that.disconnectTimeout);
        that.disconnectTimeout = null;
        that.openPortTimeout && clearTimeout(that.openPortTimeout);
        that.openPortTimeout = null;

        if (this._interface && this._interface.isOpen) {
            //serial
            this._interface.close();
        }
        this._interface = null;
        this._interfaceParser = null;
    };

    return this;
}

// extend the EventEmitter class using our Radio class
util.inherits(Serial, EventEmitter);

module.exports = Serial;
