var Avrgirl;

function flash(options, config, log, callback) {
    var fs = require('fs');
    if (!Avrgirl) {
        try {
            Avrgirl = require('avrgirl-arduino');
        } catch (e) {
            log.error('Cannot init AvrFlash');
            if (callback) callback('Cannot init AvrFlash');
            return;
        }
    }

    var avrgirl = new Avrgirl({
        board:  config.board || 'mega',
        port:   config.comName ? config.comName : undefined,
        debug:  function () {
            log.debug.apply(log, arguments);
        }
    });

    if (!options.hex) {
        log.error('No hex file or source defined');
        if (callback) callback('No hex file or source defined');
        return;
    }

    if (options.hex.length < 1024) {
        if (!fs.existsSync(options.hex)) {
            log.error('Cannot find hex file: ' + options.hex);
            if (callback) callback('Cannot find hex file: ' + options.hex);
            return;
        } else {
            options.hex = fs.readFileSync(options.hex);
        }
    } else {
        // try to convert BASE64 string to buffer
        try {
            options.hex = Buffer.from(options.hex, 'base64');
        } catch (e) {
            log.error('Cannot parse base64 hex: ' + e);
            if (callback) callback('Cannot parse base64 hex: ' + e);
            return;
        }
    }

    log.info('Start flash of ' + options.hex.length + 'bytes');
    avrgirl.flash(options.hex, function (error) {
        if (error) {
            log.error('No hex file or source defined: ' + error);
        } else {
            log.info('Flash is finished');
        }

        if (callback) callback(error);
    });

}
module.exports = flash;