/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

// you have to require the utils module and call adapter function
var utils      = require(__dirname + '/lib/utils'); // Get common adapter utils
var serialport = require('serialport');
var Parses     = require(__dirname + '/admin/parse.js');

var adapter   = utils.adapter('rflink');
var devices   = {};
var inclusionOn = false;
var inclusionTimeout = false;

var config = {};

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
        if (serialport && serialport.isOpen()) serialport.close();
        serialport = null;
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    if (!state || state.ack || !mySensorsInterface) return;

    // Warning, state can be null if it was deleted
    adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));

    if (id === adapter.namespace + '.inclusionOn') {
        setInclusionState(state.val);
    } else
    // output to rflink
    if (devices[id] && devices[id].type === 'state') {

    }
});

adapter.on('objectChange', function (id, obj) {
    if (!obj) {
        if (devices[id]) delete devices[id];
    } else {
        devices[id] = obj;
    }
});

adapter.on('ready', function () {
    main();
});

var presentationDone = false;

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

function findDevice(result, ip, subType) {
    for (var id in devices) {
        if (devices[id].native &&
            (!ip || ip === devices[id].native.ip) &&
            devices[id].native.id == result.id &&
            devices[id].native.childId == result.childId &&
            (subType === false || devices[id].native.varType == result.subType)) {
            return id;
        }
    }
    return -1;
}

function main() {
    adapter.config.inclusionTimeout = parseInt(adapter.config.inclusionTimeout, 10) || 0;

    adapter.getState('inclusionOn', function (err, state) {
        setInclusionState(state ? state.val : false);
    });

    // read current existing objects (прочитать текущие существующие объекты)
    adapter.getForeignObjects(adapter.namespace + '.*', 'state', function (err, states) {
        // subscribe on changes
        adapter.subscribeStates('*');
        adapter.subscribeObjects('*');
        devices = states;

    });
}