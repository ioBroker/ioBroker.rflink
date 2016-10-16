![Logo](admin/rflink.png)
# ioBroker.rflink
=================

[![NPM version](http://img.shields.io/npm/v/iobroker.rflink.svg)](https://www.npmjs.com/package/iobroker.rflink)
[![Downloads](https://img.shields.io/npm/dm/iobroker.rflink.svg)](https://www.npmjs.com/package/iobroker.rflink)
[![Tests](https://travis-ci.org/ioBroker/ioBroker.rflink.svg?branch=master)](https://travis-ci.org/ioBroker/ioBroker.rflink)

[![NPM](https://nodei.co/npm/iobroker.rflink.png?downloads=true)](https://nodei.co/npm/iobroker.rflink/)

This adapter communicates with [rflink](http://www.nemcon.nl/blog2/) build on arduino mega and RFC 433MHz/866MHz/2.6Gz communication. 
Used for receiving the data from weather sensors and wireless power switches.

## Prerequires
To use serial port on Windows it is VS required to build the binary.
To use serial port on linux it is build-essential an python2.7 required. To install them just write:

```
sudo apt-get update
sudo apt-get install build-essential
sudo apt-get install python2.7
```

## Usage
To enable the learning of sensors you must activate "Inclusion mode". The inclusion mode by default will be enabled for 5 minutes (300000 ms) and after 5 minutes will be disabled automatically.

To enable inclusion mode forever, just set "Inclusion timeout" to 0.

## Pair
The devices get the new address every time the battery changed. 

So after the battery changed it must be learned anew. 

To do that press the pair button just before inserting the battery and the device will be learned with new address. 

## Auto pairing
If you have not so many sensors in the near you can activate auto re-pairing. 

It is possible only if the device can be definitely identified.

That means that only one device with this brand and type is present. (E.g. only one temperature sensor from one brand)

If system detect more than one device with such a parameter it will automatically deactivate the auto re-pairing mode and indicate problem sensors with flash.


## Changelog
### 0.1.0 (2016-10-14)
* (bluefox) initial commit

