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

## Changelog
### 0.1.0 (2016-10-14)
* (bluefox) initial commit

