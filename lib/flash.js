'use strict';

let Avrgirl;

function flash(options, config, log, callback) {
    const fs = require('fs');
    if (!Avrgirl) {
        try {
            Avrgirl = require('avrgirl-arduino');
        } catch (e) {
            log.error('Cannot init AvrFlash');
            return callback && callback('Cannot init AvrFlash');
        }
    }

    const avrgirl = new Avrgirl({
        board:  config.board || 'mega',
        port:   config.comName ? config.comName : undefined,
        debug:  function () {
            log.debug.apply(log, arguments);
        }
    });

    if (!options.hex) {
        log.error('No hex file or source defined');
        return callback && callback('No hex file or source defined');
    }

    if (options.hex.match && options.hex.match(/^https?:\/\//)) {
        require('request')(options.hex, (err, message, data) => {
            if (!err && data) {
                options.hex = new Buffer(data).toString('base64');
                flash(options, config, log, callback)
            } else {
                log.error('Cannot load URL: ' + options.hex);
                callback && callback('Cannot load URL: ' + options.hex);
            }
        });
        return;
    }

    if (options.hex.length < 1024) {
        if (!fs.existsSync(options.hex)) {
            log.error('Cannot find hex file: ' + options.hex);
            return callback && callback('Cannot find hex file: ' + options.hex);
        } else {
            options.hex = fs.readFileSync(options.hex);
        }
    } else {
        // try to convert BASE64 string to buffer
        try {
			if (typeof Buffer.from === 'function' && parseInt(process.version.replace('v', '')) > 4) {
				// Node 5.10+
				options.hex = Buffer.from(options.hex, 'base64');
			} else {
				// older Node versions
				options.hex = new Buffer(options.hex, 'base64');
			}
        } catch (e) {
            log.error('Cannot parse base64 hex: ' + e);
            return callback && callback('Cannot parse base64 hex: ' + e);
        }
    }

    log.info('Start flash of ' + options.hex.length + 'bytes');
    avrgirl.flash(options.hex, error => {
        if (error) {
            log.error('No hex file or source defined: ' + error);
        } else {
            log.info('Flash is finished');
        }

        callback && callback(error);
    });

}
module.exports = flash;