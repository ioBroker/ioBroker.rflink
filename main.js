/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
var utils        = require(__dirname + '/lib/utils'); // Get common adapter utils
var serialport   = require('serialport');
var Parses       = require(__dirname + '/admin/parse.js');
var Serial       = process.env.DEBUG ? require(__dirname + '/lib/debug.js') : require(__dirname + '/lib/serial.js');

var adapter      = utils.adapter('rflink');
var channels     = {};
var states       = {};
var inclusionOn  = false;
var inclusionTimeout = false;
var addQueue     = [];
var frameID      = 1;
var lastReceived = {};
var repairInterval = null;
var comm;
var skipFirst    = true;

adapter.on('message', function (obj) {
    if (obj) {
        switch (obj.command) {
            case 'listUart':
                if (obj.callback) {
                    if (serialport) {
                        // read all found serial ports
                        serialport.list(function (err, ports) {
                            adapter.log.info('List of port: ' + JSON.stringify(ports));
                            adapter.sendTo(obj.from, obj.command, ports, obj.callback);
                        });
                    } else {
                        adapter.log.warn('Module serialport is not available');
                        adapter.sendTo(obj.from, obj.command, [{comName: 'Not available'}], obj.callback);
                    }
                }

                break;
        }
    }
});

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    adapter.setState('info.connection', false, true);
    try {
        if (repairInterval) {
            clearInterval(repairInterval);
            repairInterval = null;
        }

        if (comm) comm.destroy();
        comm = null;
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    if (!state || state.ack || !comm) return;

    // Warning, state can be null if it was deleted
    adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));

    if (id === adapter.namespace + '.inclusionOn') {
        setInclusionState(state.val);
        setTimeout(function (val) {
            adapter.setState('inclusionOn', val, true);
        }, 200, state.val);
    } else
    // output to rflink
    if (states[id] && states[id].common.write) {
        writeCommand(id, state.val, function (err) {
            if (err) adapter.log.error('Cannot write "' + id + '": ' + err);
        });
    }
});

adapter.on('objectChange', function (id, obj) {
    if (!obj) {
        if (channels[id])     delete channels[id];
        if (states[id])       delete states[id];
        if (lastReceived[id]) delete lastReceived[id];
    } else {
        if (obj.type === 'state') {
            states[id] = obj
        } else if (obj.type === 'channel') {
            //if (obj.native.autoRepair !== undefined) obj.native.autoRepair = parseInt(obj.native.autoRepair, 10) || 0;

            if (obj.native.autoRepair) {
                lastReceived[id] = new Date().getTime();
            } else if (lastReceived[id]) {
                delete lastReceived[id];
            }

            channels[id] = obj;
        }
    }
});

adapter.on('ready', function () {
    main();
});

var presentationDone = false;

function writeCommand(id, value, callback) {
    var command = '10;' + (frameID++) + ';' + states[id].native.brand + ';' + Parses.encodeValue('ID', states[id].native.ID) + ';';
    if (states[id].native.switch !== undefined) command += 'SWITCH=' + states[id].native.switch + ';'
    if (states[id].native.blind) {
        if (value === 'true' || value === true || value === '1' || value === 1) {
            value = 'UP';
        } else {
            value = 'DOWN';
        }
        command += 'CMD=' + value + ';';
    } else if (states[id].native.all) {
        if (value === 'true' || value === true || value === '1' || value === 1) {
            value = 'ALLON';
        } else {
            value = 'ALLOFF';
        }
        command += 'CMD=' + value + ';';
    } else if (states[id].native.set_level) {
        command += 'CMD=SET_LEVEL=' + value + ';';
    } else if (states[id].native.switch !== undefined) {
        if (value === 'true' || value === true || value === '1' || value === 1) {
            value = 'ON';
        } else {
            value = 'OFF';
        }
        command += 'CMD=' + value + ';';
    } else if (states[id].native.attr === 'RGBW') {
        command += 'CMD=ON;' + states[id].native.attr + '=' + value + ';';
    } else if (states[id].native.attr === 'CHIME') {
        command += 'CMD=ON;' + states[id].native.attr + '=' + value + ';';
    } else {
        command += states[id].native.attr + '=' + value + ';';
    }
    adapter.log.debug('Write: ' + command);
    comm.write(command, callback);
}

function setInclusionState(val) {
    val = val === 'true' || val === true || val === 1 || val === '1';
    inclusionOn = val;

    if (inclusionTimeout) clearTimeout(inclusionTimeout);
    inclusionTimeout = null;

    if (inclusionOn) presentationDone = false;

    if (inclusionOn && adapter.config.inclusionTimeout) {
        inclusionTimeout = setTimeout(function () {
            inclusionOn = false;
            adapter.setState('inclusionOn', false, true);
        }, adapter.config.inclusionTimeout);
    }
}

function addNewDevice(frame, attrs, callback) {
    var channelObj;

    if (frame.SWITCH !== undefined) {
        // try to find existing channel
        for (id in channels) {
            if (!channels.hasOwnProperty(id) || !channels[id].native) continue;

            // If device suits to it
            if (channels[id].native.brand === frame.brandRaw &&
                channels[id].native.ID    === frame.ID &&
                channels[id].native.attrs === attrs) {
                channels[id].native.pair = false;
                channelObj = channels[id];
                newId = id;
                index = channelObj.native.index;
            }
        }
    }

    // add new device
    if (!channelObj) {
        // find unique ID
        var index = 0;
        var newId;
        do {
            index++;
            newId = adapter.namespace + '.channels.' + frame.brand + '_' + index;
        } while(channels[newId]);

        channelObj = {
            _id: newId,
            common: {
                name: frame.brand + ' ' + index,
                role: ''
            },
            native: {
                ID:         frame.ID,
                brand:      frame.brandRaw,
                attrs:      attrs,
                index:      index,
                autoRepair: false
            },
            type: 'channel'
        };
    }

    var objs = Parses.analyseFrame(frame, newId, index);

    // analyse if some switches are there
    for (var id in objs) {
        if (!objs.hasOwnProperty(id)) continue;
        if (objs[id].native.switch !== undefined) {
            channelObj.native.switches = channelObj.native.switches || [];
            if (channelObj.native.switches.indexOf(objs[id].native.switch) === -1) {
                channelObj.native.switches.push(objs[id].native.switch);
            }
        }
    }

    objs.push(channelObj);

    function insertObjs(_objs) {
        if (!_objs || !_objs.length) {
            adapter.log.info('done ' + newId);

            for (var i = 0; i < objs.length; i++) {
                if (objs[i].type === 'state') {
                    states[objs[i]._id] = objs[i];
                } else {
                    channels[objs[i]._id] = objs[i];
                }
            }
            objs  = null;
            _objs = null;

            callback && callback();
        } else {
            var obj = _objs.pop();
            adapter.log.info('Add ' + obj._id);
            adapter.getForeignObject(obj._id, function (err, oldObj) {
                if (!oldObj) {
                    setTimeout(function () {

                        adapter.setForeignObject(obj._id, obj, function () {
                            if (frame[obj.native.attr] !== undefined) {
                                adapter.log.debug('Set state "' + obj._id + '": ' + frame[obj.native.attr]);

                                if (typeof frame[obj.native.attr] === 'number' && obj.native.factor) {
                                    frame[obj.native.attr] = obj.native.factor * frame[obj.native.attr] + obj.native.offset;
                                }
                                //adapter.setState('rawData', frame.dataRaw, true);
                                adapter.setForeignState(obj._id, frame[obj.native.attr], true, function () {
                                    insertObjs(_objs);
                                });
                            } else {
                                insertObjs(_objs);
                            }
                        });
                    }, 50);
                } else {
                    // merge switches
                    if (oldObj.native.switches) {
                        if (!obj.native.switches) {
                            adapter.log.error('Commands are different for ' + obj._id + ': ' + obj.native.attrs + ' <> ' + oldObj.native.attrs);
                        } else {
                            for (var s = 0; s < obj.native.switches.length; s++) {
                                if (oldObj.native.switches.indexOf(obj.native.switches[s]) === -1) oldObj.native.switches.push(obj.native.switches[s]);
                            }
                            obj.native.switches = oldObj.native.switches;
                        }
                    }

                    if (oldObj.native.factor     !== undefined) obj.native.factor     = oldObj.native.factor;
                    if (oldObj.native.offset     !== undefined) obj.native.offset     = oldObj.native.offset;
                    if (oldObj.native.autoRepair !== undefined) obj.native.autoRepair = oldObj.native.autoRepair;

                    oldObj.native = obj.native;
                    setTimeout(function () {
                        adapter.setForeignObject(oldObj._id, oldObj, function () {
                            if (frame[obj.native.attr] !== undefined) {
                                adapter.log.debug('Set state "' + obj._id + '": ' + frame[obj.native.attr]);

                                if (typeof frame[obj.native.attr] === 'number' && obj.native.factor) {
                                    frame[obj.native.attr] = obj.native.factor * frame[obj.native.attr] + obj.native.offset;
                                }

                                //adapter.setState('rawData', frame.dataRaw, true);
                                adapter.setForeignState(obj._id, frame[obj.native.attr], true, function () {
                                    insertObjs(_objs);
                                });
                            } else {
                                insertObjs(_objs);
                            }
                        });
                    }, 50)
                }
            });
        }
    }

    insertObjs(JSON.parse(JSON.stringify(objs)));
}

function processAdd() {
    if (!addQueue.length) return;

    var frame = addQueue[0];
    processFrame(frame, true, function () {
        setTimeout(function () {
            addQueue.shift();
            processAdd();
        }, 100);
    });
}

function processFrame(frame, isAdd, callback) {
    adapter.setState('rawData', frame.dataRaw, true);
    var id;
    for (id in channels) {
        if (!channels.hasOwnProperty(id) || !channels[id].native) continue;

        if (frame.brandRaw === channels[id].native.brand && frame.ID === channels[id].native.ID) {

            // remove pair flag
            if (channels[id].native.pair) {
                channels[id].native.pair = false;
                if (channels[__id].native.autoPairProblem !== undefined) delete channels[__id].native.autoPairProblem;
                adapter.log.debug('Disable pair for "' + id);
                adapter.setForeignObject(id, channels[id]);
            }

            // try to find state
            if (frame.SWITCH !== undefined) {
                var stateId;
                if (frame.blind) {
                    stateId = id + '.BLIND_' + frame.SWITCH;
                } else if (frame.all) {
                    stateId = id + '.ALL_' + frame.SWITCH;
                }  else if (frame.chime) {
                    stateId = id + '.CHIME_' + frame.SWITCH;
                } else if (frame.set_level) {
                    stateId = id + '.SET_LEVEL_' + frame.SWITCH;
                } else {
                    stateId = id + '.SWITCH_' + frame.SWITCH;
                }

                if (states[stateId]) {
                    adapter.log.debug('Set state "' + stateId + '": ' + frame.CMD);

                    (function (__id) {
                        adapter.setForeignState(stateId, frame.CMD, true, function (err) {
                            if (states[__id + '.RGBW_' + frame.SWITCH] && frame.RGBW !== undefined) {
                                adapter.log.debug('Set state "' + __id + '.RGBW_' + frame.SWITCH + '": ' + frame.RGBW);
                                adapter.setForeignState(__id + '.RGBW_' + frame.SWITCH, frame.RGBW, true, function () {
                                    if (callback) callback();
                                })
                            } else if (states[__id + '.CHIME_' + frame.SWITCH] && frame.CHIME !== undefined) {
                                adapter.log.debug('Set state "' + __id + '.CHIME_' + frame.SWITCH + '": ' + frame.CHIME);
                                adapter.setForeignState(__id + '.CHIME_' + frame.SWITCH, frame.CHIME, true, function () {
                                    if (callback) callback();
                                })
                            } else if (callback) {
                                callback();
                            }
                        });
                    })(id);

                    if (lastReceived[id]) lastReceived[id] = new Date().getTime();

                    return;
                }
            } else {
                var count = 0;
                for (var _attr in frame) {
                    if (!frame.hasOwnProperty(_attr)) continue;
                    if (Parses.doNotProcess.indexOf(_attr) !== -1) continue;

                    if (states[id + '.' + _attr]) {
                        count++;
                        adapter.log.debug('Set state "' + id + '.' + _attr + '": ' + frame[_attr]);

                        if (typeof frame[_attr] === 'number' && states[id + '.' + _attr].native.factor) {
                            frame[_attr] = states[id + '.' + _attr].native.factor * frame[_attr] + states[id + '.' + _attr].native.offset;
                        }

                        adapter.setForeignState(id + '.' + _attr, frame[_attr], true, function () {
                            if (!--count && callback) callback();
                        });
                    }
                }
                if (count) {
                    if (lastReceived[id]) lastReceived[id] = new Date().getTime();
                    return;
                }
            }
        }
    }
    var attrs = [];
    for (var attr in frame) {
        if (!frame.hasOwnProperty(attr))continue;
        if (Parses.doNotProcess.indexOf(attr) !== -1) continue;
        attrs.push(attr);
    }
    attrs.sort();
    attrs = attrs.join(';');

    // pairs
    // find in pairs suitable device
    for (var j in channels) {
        if (!channels.hasOwnProperty(j) || !channels[j].native) continue;

        // If device suits to it
        if (channels[j].native.pair && channels[j].native.brand === frame.brandRaw &&
            channels[j].native.attrs === attrs &&
            (frame.SWITCH === undefined || (channels[j].native.switches && channels[j].native.switches.indexOf(frame.SWITCH) !== -1))
        ) {
            adapter.log.debug('Pair "' + j + ': old ID ' + channels[j].native.ID + ', new ID ' + frame.ID);

            channels[j].native.pair = false;
            channels[j].native.ID   = frame.ID;
            if (channels[j].native.autoPairProblem !== undefined) delete channels[j].native.autoPairProblem;

            adapter.setForeignObject(j, channels[j], function (err) {
                if (err) adapter.log.error('Cannot set object : ' + err);
                processFrame(frame, isAdd, callback);
            });
            return;
        }
    }

    // autoPairs
    var pairs      = [];
    var autoRepair = [];
    for (var __id in channels) {
        if (!channels.hasOwnProperty(__id) || !channels[__id].native) continue;

        // If device suits to it
        if (channels[__id].native.brand === frame.brandRaw &&
            channels[__id].native.attrs === attrs &&
            (frame.SWITCH === undefined || (channels[__id].native.switches && channels[__id].native.switches.indexOf(frame.SWITCH) !== -1))
        ) {
            adapter.log.debug('Pair "' + __id + ': old ID ' + channels[__id].native.ID + ', new ID ' + frame.ID);

            pairs.push(__id);

            if (channels[__id].native.autoRepair) autoRepair.push(__id);
        }
    }

    if (pairs.length === 1 && channels[pairs[0]].native.autoRepair) {
        if (channels[pairs[0]].native.autoPairProblem !== undefined) delete channels[pairs[0]].native.autoPairProblem;
        channels[pairs[0]].native.ID = frame.ID;

        adapter.setForeignObject(pairs[0], channels[pairs[0]], function (err) {
            if (err) adapter.log.error('Cannot set object: ' + err);
            processFrame(frame, isAdd, callback);
        });
        return;
    } else if (pairs.length > 1 && autoRepair.length) {
        // Problem more than one device suits to it
        adapter.log.warn('Cannot auto pair because following sensors have similar parameters: ' + pairs.join(', '));
        for (var i = 0; i < pairs.length; i++) {
            if (!channels[pairs[i]].native.autoPairProblem) {
                channels[pairs[i]].native.autoPairProblem = true;
                adapter.setForeignObject(pairs[i], channels[pairs[i]], function (err) {
                    if (err) adapter.log.error('Cannot set object: ' + err);
                });
            }
        }
        return;
    }

    if (inclusionOn) {
        if (!isAdd) {
            addQueue.push(frame);
            if (addQueue.length === 1) {
                setTimeout(processAdd, 100);
            }
            if (callback) callback ();
        } else {
            addNewDevice(frame, attrs, callback);
        }
    }
}

// deactivated
/*
 function checkAutoRepair() {
 var now = new Date().getTime();
 for (var id in channels) {
 if (!lastReceived[id]) return;
 if (!channels.hasOwnProperty(id)) continue;

 if (now - lastReceived[id] > channels[id].native.autoRepair * 60000) {
 channels[id].native.autoPair = true;
 adapter.log.debug('Enable auto re-pair for "' + id + '" because no data from minimum ' + channels[id].native.autoRepair + ' minutes');
 adapter.setForeignObject(id, channels[id]);
 }
 }
 }
 */
function main() {
    adapter.config.inclusionTimeout = parseInt(adapter.config.inclusionTimeout, 10) || 0;

    adapter.getState('inclusionOn', function (err, state) {
        setInclusionState(state ? state.val : false);
    });

    adapter.setState('info.connection', false, true);

    // read current existing objects (прочитать текущие существующие объекты)
    adapter.getForeignObjects(adapter.namespace + '.*', 'state', function (err, _states) {
        states = _states;
        adapter.getForeignObjects(adapter.namespace + '.*', 'channel', function (err, _channels) {
            channels = _channels;
            // subscribe on changes
            adapter.subscribeStates('*');
            adapter.subscribeObjects('*');

            // Mark all sensors as if they received something
            for (var id in channels) {
                if (!channels.hasOwnProperty(id)) continue;
                // autoRepair is true or false
                //channels[id].native.autoRepair = parseInt(channels[id].native.autoRepair, 10) || 0;

                if (channels[id].native.autoRepair) lastReceived[id] = new Date().getTime();
            }
            // deactivated
            //repairInterval = setInterval(checkAutoRepair, 60000);

            comm = new Serial(adapter.config, adapter.log, function (err) {
                // done
                if (err) {
                    adapter.log.error('Cannot open port: ' + err);
                } else {
                    comm.write('10;REBOOT;');
                }
            });
            comm.on('connectionChange', function (connected) {
                if (!connected) skipFirst = true;
                adapter.setState('info.connection', connected, true);
            });
            comm.on('data', function (data) {
                var frame = Parses.parseString(data);
                if (frame && !skipFirst) {
                    processFrame(frame);
                } else {
                    if (skipFirst) skipFirst = false;
                    adapter.log.debug('Skip frame: ' + data);
                }
            });
        });
    });
}