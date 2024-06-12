/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
const utils        = require('@iobroker/adapter-core'); // Get common adapter utils
const adapterName  = require('./package.json').name.split('.').pop();
const Parses       = require('./admin/parse.js');
const Serial       = process.env.DEBUG ? require('./lib/debug.js') : require('./lib/serial.js');
let adapter;
const serialport = require('serialport');

let channels       = {};
let states         = {};
let inclusionOn    = false;
let inclusionTimeout = false;
let inclusionTimeoutObj = null;
const addQueue     = [];
const lastReceived = {};
let repairInterval = null;
let skipFirst      = true;
const flash        = require('./lib/flash.js');
let comm;
let fwLink;

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {name: adapterName});
    adapter = new utils.Adapter(options);
    adapter.on('message', obj => {
        if (obj) {
            switch (obj.command) {
                case 'listUart':
                    if (obj.callback) {
                        if (serialport) {
                            // read all found serial ports
                            serialport.list().then(ports => {
                                adapter.log.info('List of port: ' + JSON.stringify(ports));
                                adapter.sendTo(obj.from, obj.command, ports, obj.callback);
                            }).catch(_err => {
                                adapter.log.warn('Error getting serialport list');
                            });
                        } else {
                            adapter.log.warn('Module serialport is not available');
                            adapter.sendTo(obj.from, obj.command, [{comName: 'Not available'}], obj.callback);
                        }
                    }

                    break;

                case 'readNewVersion':
                    const request = require('request');
                    request('http://www.nemcon.nl/blog2/fw/iob/update.jsp', (error, message, data) => {
                        let m;
                        if ((m = data.match(/iob\/(\d+)\/RFLink\.cpp\.hex/))) {
                            adapter.setState('availableVersion', m[1], true);
                        }
                        if (obj.callback) {
                            if ((m = data.match(/<Url>(.+)<\/Url>/))) {
                                fwLink = m[1];
                            }
                            if (obj.callback) {
                                adapter.sendTo(obj.from, obj.command, {fwLink: fwLink}, obj.callback);
                            }
                        }
                    });

                    break;

                case 'flash':
                    if (comm) {
                        comm.destroy();
                        comm = null;
                    }


                    obj.message = obj.message || {};
                    obj.message.hex = obj.message.hex || fwLink;
                    if (!obj.message.hex) {
                        const dirs = require('fs').readdirSync(__dirname + '/hex');
                        if (dirs && dirs.length) {
                            obj.message.hex = __dirname + '/hex/' + dirs[0];
                        }
                    }

                    flash(obj.message, adapter.config, adapter.log, err => {
                        if (obj.callback) {
                            if (err) adapter.log.error('Cannot flash: ' + err);
                            adapter.sendTo(obj.from, obj.command, {error: err ? (err.message || err) : null}, obj.callback);
                        } else {
                            if (err) adapter.log.error('Cannot flash: ' + err);
                            obj = null;
                        }
                        // start communication again
                        start(true);
                    });
                    break;

                default:
                    adapter.log.error('Unknown command: ' + obj.command);
                    break;
            }
        }
    });

    // is called when adapter shuts down - callback has to be called under any circumstances!
    adapter.on('unload', callback => {
        adapter.setState('info.connection', false, true);

        inclusionTimeoutObj && clearTimeout(inclusionTimeoutObj);
        inclusionTimeoutObj = null;

        try {
            if (repairInterval) {
                clearInterval(repairInterval);
                repairInterval = null;
            }

            comm && comm.destroy();
            comm = null;
            callback();
        } catch (e) {
            callback();
        }
    });

    // is called if a subscribed state changes
    adapter.on('stateChange', (id, state) => {
        if (!state || state.ack || !comm) {
            return;
        }

        // Warning, state can be null if it was deleted
        adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));

        if (id === adapter.namespace + '.rawData') {
            // write raw command
            setTimeout(cmd => {
                adapter.log.debug('Write: ' + cmd);
                if (comm) {
                    comm.write(cmd, err => {
                        err && adapter.log.error('Cannot write "' + cmd + '": ' + err);
                        cmd = null;
                    });
                }
            }, 0, state.val);
        } else if (id === adapter.namespace + '.inclusionOn') {
            setInclusionState(state.val);
            setTimeout(val => adapter.setState('inclusionOn', val, true), 200, state.val);
        } else
            // output to rflink
        if (states[id] && states[id].common.write) {
            writeCommand(id, state.val, err =>
                err && adapter.log.error('Cannot write "' + id + '": ' + err));
        }
    });

    adapter.on('objectChange', (id, obj) => {
        if (!obj) {
            if (channels[id]) {
                delete channels[id];
            }
            if (states[id]) {
                delete states[id];
            }
            if (lastReceived[id]) {
                delete lastReceived[id];
            }
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

    adapter.on('ready', () => main());

    return adapter;
}

let presentationDone = false;

function writeCommand(id, value, callback) {
    let command = '10;' + states[id].native.brand + ';' + Parses.encodeValue('ID', states[id].native.ID) + ';';

    if (states[id].native.attr === 'COLOR') {
        value = value.toString(16);
        if (value.length < 2) value = '0' + value;
        command += '01;' + value + 'BC;COLOR;';
    } else
    if (states[id].native.attr === 'BRIGHT') {
        value = value.toString(16);
        if (value.length < 2) value = '0' + value;
        command += '01;34' + value + ';BRIGHT;';
    }  else
    if (states[id].native.attr === 'MODE') {
        command += '00;3c00;MODE' + value  + ';';
    } else
    if (states[id].native.attr === 'DISCO') {
        command += '00;3c00;' + states[id].native.value + ';'; // if 3c00 (COLOR|BRIGHT) required ?
    } else
    if (states[id].native.brand === 'MiLightv1') {
        if (value === 'true' || value === true || value === '1' || value === 1) {
            value = 'ON';
        } else {
            value = 'OFF';
        }
        command += '00;3c00;' + value + ';';
    } else {
        if (states[id].native.switch !== undefined) {
            command += states[id].native.switch + ';';
        }

        if (states[id].native.stop) {
            value = 'STOP';
            command += value + ';';
        } else if (states[id].native.blind) {
            if (value === 'true' || value === true || value === '1' || value === 1) {
                value = 'UP';
            } else {
                value = 'DOWN';
            }
            command += value + ';';
        } else if (states[id].native.all) {
            if (value === 'true' || value === true || value === '1' || value === 1) {
                value = 'ALLON';
            } else {
                value = 'ALLOFF';
            }
            command += value + ';';
        } else if (states[id].native.set_level) {
            command += Math.max(1, Math.min(100, (value - 1) / 99 * 15)) + ';';
        } else if (states[id].native.switch !== undefined) {
            if (value === 'true' || value === true || value === '1' || value === 1) {
                value = 'ON';
            } else {
                value = 'OFF';
            }
            command += value + ';';
        } else if (states[id].native.attr === 'RGBW') {
            command +=  states[id].native.attr + '=' + value + ';';
        } else if (states[id].native.attr === 'CHIME') {
            command += states[id].native.attr + '=' + value + ';';
        } else {
            command += states[id].native.attr + '=' + value + ';';
        }
    }

    adapter.log.debug('Write: ' + command);
    if (comm) comm.write(command, callback);
}

function setInclusionState(val) {
    val = val === 'true' || val === true || val === 1 || val === '1';
    inclusionOn = val;

    if (inclusionTimeout) {
        clearTimeout(inclusionTimeout);
    }
    inclusionTimeout = null;

    if (inclusionOn) {
        presentationDone = false;
    }

    if (inclusionOn && adapter.config.inclusionTimeout) {
        inclusionTimeout = setTimeout(() => {
            inclusionOn = false;
            adapter.setState('inclusionOn', false, true);
        }, adapter.config.inclusionTimeout);
    }
}

//20;12;Cresta;ID=4D02;TEMP=00c9;HUM=57;BAT=OK;
function addNewDevice(frame, attrs, callback) {
    let channelObj;
    let index = 0;
    let newId;

    if (frame.SWITCH !== undefined) {
        // try to find existing channel
        for (const id in channels) {
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
        index = 0;
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

    let objs = Parses.analyseFrame(frame, newId, index);

    // analyse if some switches are there
    for (const id in objs) {
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

            for (let i = 0; i < objs.length; i++) {
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
            const obj = _objs.pop();
            adapter.getForeignObject(obj._id, (err, oldObj) => {
                if (!oldObj) {
                    setTimeout(() => {
                        adapter.log.info('Add ' + obj._id);
                        adapter.setForeignObject(obj._id, obj, () => {
                            if (frame[obj.native.attr] !== undefined) {
                                adapter.log.debug('Set state "' + obj._id + '": ' + frame[obj.native.attr]);

                                if (typeof frame[obj.native.attr] === 'number' && obj.native.factor) {
                                    frame[obj.native.attr] = obj.native.factor * frame[obj.native.attr] + obj.native.offset;
                                }
                                //adapter.setState('rawData', frame.dataRaw, true);
                                adapter.setForeignState(obj._id, frame[obj.native.attr], true, () => insertObjs(_objs));
                            } else {
                                insertObjs(_objs);
                            }
                        });
                    }, 50);
                } else {
                    adapter.log.info('Update ' + obj._id);
                    // merge switches
                    if (oldObj.native.switches) {
                        if (!obj.native.switches) {
                            adapter.log.error('Commands are different for ' + obj._id + ': ' + obj.native.attrs + ' <> ' + oldObj.native.attrs);
                        } else {
                            for (let s = 0; s < obj.native.switches.length; s++) {
                                if (oldObj.native.switches.indexOf(obj.native.switches[s]) === -1) oldObj.native.switches.push(obj.native.switches[s]);
                            }
                            obj.native.switches = oldObj.native.switches;
                        }
                    }

                    if (oldObj.native.factor     !== undefined) obj.native.factor     = oldObj.native.factor;
                    if (oldObj.native.offset     !== undefined) obj.native.offset     = oldObj.native.offset;
                    if (oldObj.native.autoRepair !== undefined) obj.native.autoRepair = oldObj.native.autoRepair;

                    oldObj.native = obj.native;
                    setTimeout(() => {
                        adapter.setForeignObject(oldObj._id, oldObj, () => {
                            if (frame[obj.native.attr] !== undefined) {
                                adapter.log.debug('Set state "' + obj._id + '": ' + frame[obj.native.attr]);

                                if (typeof frame[obj.native.attr] === 'number' && obj.native.factor) {
                                    frame[obj.native.attr] = obj.native.factor * frame[obj.native.attr] + obj.native.offset;
                                }

                                //adapter.setState('rawData', frame.dataRaw, true);
                                adapter.setForeignState(obj._id, frame[obj.native.attr], true, () =>
                                    insertObjs(_objs));
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
    if (!addQueue.length) {
        return;
    }

    const frame = addQueue[0];
    processFrame(frame, true, () =>
        setTimeout(() => {
            addQueue.shift();
            processAdd();
        }, 100));
}

function processFrame(frame, isAdd, callback) {
    adapter.setState('rawData', frame.dataRaw, true);
    let id;
    for (id in channels) {
        if (!channels.hasOwnProperty(id) || !channels[id].native) continue;

        if (frame.brandRaw === channels[id].native.brand && frame.ID === channels[id].native.ID) {

            // remove pair flag
            if (channels[id].native.pair) {
                channels[id].native.pair = false;
                if (channels[id].native.autoPairProblem !== undefined) delete channels[id].native.autoPairProblem;
                adapter.log.debug('Disable pair for "' + id);
                adapter.setForeignObject(id, channels[id]);
            }

            // try to find state
            if (frame.SWITCH !== undefined) {
                let stateId;
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
                        adapter.setForeignState(stateId, frame.CMD, true, () => {
                            if (states[__id + '.RGBW_' + frame.SWITCH] && frame.RGBW !== undefined) {
                                adapter.log.debug('Set state "' + __id + '.RGBW_' + frame.SWITCH + '": ' + frame.RGBW);
                                adapter.setForeignState(__id + '.RGBW_' + frame.SWITCH, frame.RGBW, true, () => {
                                    callback && callback();
                                })
                            } else if (states[__id + '.CHIME_' + frame.SWITCH] && frame.CHIME !== undefined) {
                                adapter.log.debug('Set state "' + __id + '.CHIME_' + frame.SWITCH + '": ' + frame.CHIME);
                                adapter.setForeignState(__id + '.CHIME_' + frame.SWITCH, frame.CHIME, true, () => {
                                    callback && callback();
                                })
                            } else if (callback) {
                                callback();
                            }
                        });
                    })(id);

                    if (lastReceived[id]) {
                        lastReceived[id] = new Date().getTime();
                    }

                    return;
                }
            } else {
                let count = 0;
                for (const _attr in frame) {
                    if (!frame.hasOwnProperty(_attr)) continue;
                    if (Parses.doNotProcess.indexOf(_attr) !== -1) continue;

                    if (states[id + '.' + _attr]) {
                        count++;
                        adapter.log.debug('Set state "' + id + '.' + _attr + '": ' + frame[_attr]);

                        if (typeof frame[_attr] === 'number' && states[id + '.' + _attr].native.factor) {
                            frame[_attr] = states[id + '.' + _attr].native.factor * frame[_attr] + states[id + '.' + _attr].native.offset;
                        }

                        adapter.setForeignState(id + '.' + _attr, frame[_attr], true, () => {
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
    let attrs = [];
    for (const attr in frame) {
        if (!frame.hasOwnProperty(attr)) continue;
        if (Parses.doNotProcess.indexOf(attr) !== -1) continue;
        attrs.push(attr);
    }
    attrs.sort();
    attrs = attrs.join(';');

    // pairs
    // find in pairs suitable device
    for (const j in channels) {
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

            adapter.setForeignObject(j, channels[j], err => {
                err && adapter.log.error('Cannot set object : ' + err);
                processFrame(frame, isAdd, callback);
            });
            return;
        }
    }

    // autoPairs
    const pairs      = [];
    const autoRepair = [];
    for (const __id in channels) {
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

        adapter.setForeignObject(pairs[0], channels[pairs[0]], err => {
            err && adapter.log.error('Cannot set object: ' + err);
            processFrame(frame, isAdd, callback);
        });
        return;
    } else if (pairs.length > 1 && autoRepair.length) {
        // Problem more than one device suits to it
        adapter.log.warn('Cannot auto pair because following sensors have similar parameters: ' + pairs.join(', '));
        for (let i = 0; i < pairs.length; i++) {
            if (!channels[pairs[i]].native.autoPairProblem) {
                channels[pairs[i]].native.autoPairProblem = true;
                adapter.setForeignObject(pairs[i], channels[pairs[i]], err =>
                    err && adapter.log.error('Cannot set object: ' + err));
            }
        }
        return;
    }

    if (inclusionOn) {
        if (!isAdd) {
            addQueue.push(frame);
            if (addQueue.length === 1) {
                inclusionTimeoutObj = setTimeout(() => {
                    inclusionTimeoutObj = null;
                    processAdd();
                }, 100);
            }
            callback && callback ();
        } else {
            addNewDevice(frame, attrs, callback);
        }
    } else {
        adapter.log.debug('Device "' + frame.brandRaw + ' not included, because inclusion mode disabled');
    }
}

function start(doNotSendStart) {
    comm = new Serial(adapter.config, adapter.log, err => {
        // done
        if (err) {
            adapter.log.error('Cannot open port: ' + err);
        } else {
            if (comm && !doNotSendStart) comm.write('10;REBOOT;');
        }
    });
    comm.on('connectionChange', connected => {
        if (!connected) {
            skipFirst = true;
        }
        adapter.setState('info.connection', connected, true);
    });
    comm.on('data', data => {
        const frame = Parses.parseString(data);
        if (frame && !skipFirst) {
            processFrame(frame);
        } else {
            adapter.setState('rawData', data, true);
            const m = data.match(/RFLink\sGateway\s(.+);/);
            if (m) {
                adapter.setState('firmwareVersion', m[1], true);
            }
            if (skipFirst) skipFirst = false;
            adapter.log.debug('Skip frame: ' + data);
        }
    });
}

// deactivated
/*
 function checkAutoRepair() {
 const now = new Date().getTime();
 for (const id in channels) {
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

    adapter.getState('inclusionOn', (err, state) =>
        setInclusionState(state ? state.val : false));

    adapter.setState('info.connection', false, true);

    // read current existing objects (прочитать текущие существующие объекты)
    adapter.getForeignObjects(adapter.namespace + '.*', 'state', (err, _states) => {
        states = _states;
        adapter.getForeignObjects(adapter.namespace + '.*', 'channel', (err, _channels) => {
            channels = _channels;
            // subscribe on changes
            adapter.subscribeStates('*');
            adapter.subscribeObjects('*');

            // Mark all sensors as if they received something
            for (const id in channels) {
                if (!channels.hasOwnProperty(id)) continue;
                // autoRepair is true or false
                //channels[id].native.autoRepair = parseInt(channels[id].native.autoRepair, 10) || 0;

                if (channels[id].native.autoRepair) {
                    lastReceived[id] = new Date().getTime();
                }
            }
            // deactivated
            //repairInterval = setInterval(checkAutoRepair, 60000);

            start();
        });
    });
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
