var expect = require('chai').expect;
var setup  = require(__dirname + '/lib/setup');
var net    = require('net');
var fs     = require('fs');

var objects     = null;
var states      = null;
var connected   = false;
var tcpClient   = new net.Socket();
var lastMessage;
var someObject;
var port        = 15003;

function checkConnection(value, _done, counter) {
    counter = counter || 0;
    if (counter > 20) {
        _done && _done('Cannot check ' + value);
        return;
    }

    states.getState('mysensors.0.info.connection', function (err, state) {
        if (err) console.error(err);
        if (state && typeof state.val == 'string' && ((value && state.val) || (!value && !state.val))) {
            connected = state.val;
            _done();
        } else {
            setTimeout(function () {
                checkConnection(value, _done, counter + 1);
            }, 500);
        }
    });
}

function checkValue(id, value, cb, counter) {
    counter = counter || 0;
    if (counter > 20) {
        cb && cb('Cannot check ' + value);
        return;
    }

    states.getState(id, function (err, state) {
        if (err) console.error(err);
        if (state && value == state.val) {
            cb(err, state);
        } else {
            setTimeout(function () {
                checkValue(id, value, cb, counter + 1);
            }, 500);
        }
    });
}

function sendMessage(message, callback) {
    tcpClient.write(message + '\n', function(err) {
        callback && callback(err);
    });
}

function sendMessages(list, interval, callback) {
    if (!list || !list.length) {
        callback && callback();
    } else {
        sendMessage(list.pop(), function (err) {
            setTimeout(function() {
                sendMessages(list, interval, callback);
            }, interval || 100);
        });
    }
}

describe('mySensors TCP: Test TCP server', function() {
    before('mySensors TCP: Start js-controller', function (_done) {
        this.timeout(600000); // because of first install from npm

        setup.setupController(function () {
            var config = setup.getAdapterConfig();
            // enable adapter
            config.common.enabled   = true;
            config.common.loglevel  = 'debug';

            config.native.mode      = 'server';
            config.native.type      = 'tcp';
            config.native.bind      = '0.0.0.0';
            config.native.connTimeout = 5000;
            config.native.port      = port;

            config.native.fileName = __dirname + '/lib/commands.txt';

            setup.setAdapterConfig(config.common, config.native);

            setup.startController(function (_objects, _states) {
                objects = _objects;
                states  = _states;
                setTimeout(function() {
                    tcpClient.on('data', function (data) {
                        if (!data) {
                            console.log('Received empty string!');
                            return;
                        }
                        var data = data.toString();
                        console.log('Received ' + data);
                        arr = data.split('\n');
                        for (var t = arr.length - 1; t >= 0; t--) {
                            if (!arr[t]) arr.splice(t, 1);
                        }
                        lastMessage = arr.length ? arr[arr.length - 1] : null;
                        console.log('lastMessage: ' + lastMessage);
                    });
                    tcpClient.on('error', function (err) {
                        console.error(err);
                    });
                    tcpClient.connect(port, '127.0.0.1', function() {
                        console.log('Connected!!');
                    });
                    _done();
                }, 1000);
            });
        });
    });

    it('mySensors TCP: Check if sensor connected to ioBroker', function (done) {
        this.timeout(4000);
        states.setState('mysensors.0.inclusionOn', true, function () {
            var commands = fs.readFileSync(__dirname + '/lib/commands.txt').toString().split(/[\r\n|\n|\r]/g);
            setTimeout(function () {
                sendMessages(commands, 10, function () {
                    if (!connected) {
                        checkConnection(true, function () {
                            expect(lastMessage).to.be.equal('0;0;3;0;19;force presentation');
                            done();
                        });
                    } else {
                        expect(lastMessage).to.be.equal('0;0;3;0;19;force presentation');
                        done();
                    }
                });
            }, 1000);
        });
    });

    it('mySensors TCP: check created objects', function (done) {
        this.timeout(5000);
        var expected = {
            "_id": "mysensors.0.127_0_0_1.0.59_DIMMER.V_PERCENTAGE",
            "common": {
                "def":          0,
                "type":         "number",
                "read":         true,
                "write":        true,
                "min":          0,
                "max":          100,
                "unit":         "%",
                "name":         "Test7 PWM 5V.V_PERCENTAGE",
                "role":         "level.dimmer"
            },
            "native": {
                "ip":           "127.0.0.1",
                "id":           "0",
                "childId":      "59",
                "subType":      "S_DIMMER",
                "subTypeNum":   4,
                "varType":      "V_PERCENTAGE",
                "varTypeNum":   3
            },
            "type":             "state"
        };

        setTimeout(function () {
            objects.getObject(expected._id, function (err, obj) {
                if (!obj) {
                    setTimeout(function () {
                        objects.getObject(expected._id, function (err, obj) {
                            expect(err).to.be.not.ok;
                            expect(obj).to.be.ok;

                            expect(JSON.stringify(expected)).to.be.equal(JSON.stringify(obj));
                            someObject = obj;
                            done();
                        });
                    }, 1000);
                } else {
                    expect(err).to.be.not.ok;
                    expect(obj).to.be.ok;

                    expect(JSON.stringify(expected)).to.be.equal(JSON.stringify(obj));
                    someObject = obj;
                    done();
                }
            });
        }, 1000);
    });

    it('mySensors TCP: it must receive numeric data', function (done) {
        this.timeout(5000);
        lastMessage = '';
        var data = someObject.native.id + ';' + someObject.native.childId + ';1;0;' + someObject.native.varTypeNum +';58.7';
        setTimeout(function () {
            tcpClient.write(data + '\n', function(err) {
                expect(err).to.be.not.ok;
                checkValue(someObject._id, 58.7, function (err, state) {
                    expect(err).to.be.not.ok;
                    expect(state).to.be.ok;
                    expect(state.val).to.be.equal(58.7);
                    expect(state.ack).to.be.equal(true);
                    done();
                });
            });
        }, 1000);
    });

    it('mySensors TCP: it must control numeric', function (done) {
        this.timeout(5000);
        lastMessage = '';
        states.setState(someObject._id, 15.5, function (err) {
            setTimeout(function () {
                expect(lastMessage).to.be.equal(someObject.native.id + ';' + someObject.native.childId + ';1;0;' + someObject.native.varTypeNum +';15.5');
                done();
            }, 1000);
        });
    });

    it('mySensors TCP: it must receive boolean data', function (done) {
        this.timeout(5000);
        lastMessage = '';
        someObject = {
            "_id": "mysensors.0.127_0_0_1.0.33_LIGHT.V_STATUS",
            "common": {
                "name": "RELAY D8.V_STATUS",
                "type": "boolean",
                "role": "state.light",
                "def": false,
                "read": true,
                "write": true
            },
            "native": {
                "ip": "127.0.0.1",
                "id": "0",
                "childId": "33",
                "subType": "S_LIGHT",
                "subTypeNum": 3,
                "varType": "V_STATUS",
                "varTypeNum": 2
            },
            "type": "state"
        };
        var data = someObject.native.id + ';' + someObject.native.childId + ';1;0;' + someObject.native.varTypeNum +';1';

        tcpClient.write(data + '\n', function(err) {
            expect(err).to.be.not.ok;
            checkValue(someObject._id, true, function (err, state) {
                expect(err).to.be.not.ok;
                expect(state).to.be.ok;
                expect(state.val).to.be.equal(true);
                expect(state.ack).to.be.equal(true);
                done();
            });
        });
    });

    it('mySensors TCP: it must control boolean', function (done) {
        this.timeout(5000);
        lastMessage = '';
        states.setState(someObject._id, true, function (err) {
            setTimeout(function () {
                expect(lastMessage).to.be.equal(someObject.native.id + ';' + someObject.native.childId + ';1;0;' + someObject.native.varTypeNum +';1');
                done();
            }, 1000);
        });
    });

    it('mySensors TCP: it must receive battery data', function (done) {
        this.timeout(5000);
        lastMessage = '';
        someObject = {
            "_id": "mysensors.0.127_0_0_1.0.255_ARDUINO_NODE.I_BATTERY_LEVEL",
            "common": {
                "name": "ETHduino by JR.I_BATTERY_LEVEL",
                "type": "number",
                "role": "value",
                "min": 0,
                "max": 100,
                "unit": "%",
                "def": 100,
                "read": true,
                "write": false
            },
            "native": {
                "ip": "127.0.0.1",
                "id": "0",
                "childId": "255",
                "subType": "S_ARDUINO_NODE",
                "subTypeNum": 17,
                "varType": "I_BATTERY_LEVEL",
                "varTypeNum": 0
            },
            "type": "state"
        };
        var data = someObject.native.id + ';255;3;0;0;50';

        tcpClient.write(data + '\n', function(err) {
            expect(err).to.be.not.ok;
            checkValue(someObject._id, 50, function (err, state) {
                expect(err).to.be.not.ok;
                expect(state).to.be.ok;
                expect(state.val).to.be.equal(50);
                expect(state.ack).to.be.equal(true);
                done();
            });
        });
    });

    it('mySensors TCP: check metrics', function (done) {
        this.timeout(5000);
        var expected = {
            "_id": "mysensors.0.127_0_0_1.0.42_TEMP.V_TEMP",
            "common": {
                "name": "dallas.V_TEMP",
                "type": "number",
                "role": "value.temperature",
                "min": 0,
                "unit": "°F",
                "def": 0,
                "read": true,
                "write": false
            },
            "native": {
                "ip": "127.0.0.1",
                "id": "0",
                "childId": "42",
                "subType": "S_TEMP",
                "subTypeNum": 6,
                "varType": "V_TEMP",
                "varTypeNum": 0
            },
            "type": "state"
        };

        setTimeout(function () {
            objects.getObject(expected._id, function (err, obj) {
                if (!obj) {
                    setTimeout(function () {
                        objects.getObject(expected._id, function (err, obj) {
                            expect(err).to.be.not.ok;
                            expect(obj).to.be.ok;
                            expect(obj.common.unit).to.be.equal('°F');

                            expect(JSON.stringify(expected)).to.be.equal(JSON.stringify(obj));
                            someObject = obj;
                            done();
                        });
                    }, 1000);
                } else {
                    expect(err).to.be.not.ok;
                    expect(obj).to.be.ok;
                    expect(obj.common.unit).to.be.equal('°F');

                    expect(JSON.stringify(expected)).to.be.equal(JSON.stringify(obj));
                    someObject = obj;
                    done();
                }
            });
        }, 1000);
    });

    it('mySensors TCP: check disconnection', function (done) {
        this.timeout(6000);
        tcpClient.destroy();

        setTimeout(function () {
            checkConnection(false, function (err) {
                expect(connected).to.be.equal('');
                done();
            });
        }, 1000);
    });

    after('mySensors TCP: Stop js-controller', function (done) {
        this.timeout(5000);
        if (tcpClient) tcpClient.destroy();
        setup.stopController(function () {
            done();
        });
    });
});
