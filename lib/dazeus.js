require('./util');
var net = require('net');
var EventEmitter = require('events').EventEmitter;
var sys = require('sys');

var DaZeus = function (connectionData, onConnect) {
    var self = this;
    EventEmitter.call(this);

    this.client = net.connect(connectionData, function () {
        connected.call(self);
        onConnect.call(self);
    });
    this.client.setEncoding('utf8');

    this.client.on('data', function (data) {
        var obj = dezeusify(data);
        obj.forEach(function (item) {
            received.call(self, item);
        });
    });

    this.client.on('end', function () {
        disconnected.call(self);
    });

    this.on('newListener', function (evt) {
        if (evt.isUpperCase() && !this.subscribedEvents.contains(evt)) {
            subscribeServerEvent.call(self, evt);
        }
    });

    this.subscribedEvents = [];
    this.waitingCallbacks = [];
};
sys.inherits(DaZeus, EventEmitter);

DaZeus.prototype.getProperty = function (property, scope, callback) {
    if (typeof scope === 'function') {
        callback = scope;
        scope = undefined;
    }

    if (typeof scope === 'undefined') {
        sendReceive.call(this, {'do': 'property', params: ['get', property]}, callback);
    } else {
        sendReceive.call(this, {'do': 'property', scope: scope, params: ['get', property]}, callback);
    }
};

DaZeus.prototype.setProperty = function (property, value, scope, callback) {
    if (typeof scope === 'function') {
        callback = scope;
        scope = undefined;
    }

    if (typeof scope === 'undefined') {
        sendReceive.call(this, {'do': 'property', params: ['set', property, value]}, callback);
    } else {
        sendReceive.call(this, {'do': 'property', scope: scope, params: ['set', property, value]}, callback);
    }
};

DaZeus.prototype.unsetProperty = function (property, scope, callback) {
    if (typeof scope === 'function') {
        callback = scope;
        scope = undefined;
    }

    if (typeof scope === 'undefined') {
        sendReceive.call(this, {'do': 'property', params: ['unset', property]}, callback);
    } else {
        sendReceive.call(this, {'do': 'property', scope: scope, params: ['unset', property]}, callback);
    }
};

DaZeus.prototype.message = function (network, channel, message, callback) {
    sendReceive.call(this, {'do': 'message', params: [network, channel, message]}, callback);
};

DaZeus.prototype.action = function (network, channel, message, callback) {
    sendReceive.call(this, {'do': 'action', params: [network, channel, message]}, callback);
};

DaZeus.prototype.join = function (network, channel, callback) {
    sendReceive.call(this, {'do': 'join', params: [network, channel]}, callback);
};

DaZeus.prototype.part = function (network, channel, callback) {
    sendReceive.call(this, {'do': 'part', params: [network, channel]}, callback);
};

DaZeus.prototype.networks = function (callback) {
    sendReceive.call(this, {'get': 'networks'}, callback);
};

DaZeus.prototype.channels = function (network, callback) {
    sendReceive.call(this, {'get': 'channels', params: [network]}, callback);
};

DaZeus.prototype.nick = function (network, callback) {
    sendReceive.call(this, {'get': 'nick', params: [network]}, callback);
};

DaZeus.prototype.whois = function (network, user, callback) {
    var self = this;
    var cb = function (nw, srv, usr, y) {
        if (nw === network && usr === user) {
            self.removeListener('WHOIS', cb);
            callback(nw, srv, usr, y);
        }
    };
    self.on('WHOIS', cb);
    send.call(this, {'do': 'whois', params: [network, user]});
};

var send = function (data, callback) {
    var message = dazeusify(data);
    this.client.write(message, callback);
};

var sendReceive = function (data, callback) {
    this.waitingCallbacks.push(callback);
    send.call(this, data);
};

var subscribeServerEvent = function (event) {
    sendReceive.call(this, {'do': 'subscribe', params: [event]}, undefined);
    this.subscribedEvents.push(event);
};

var received = function (obj) {
    if (typeof obj.event !== 'undefined') {
        handleEvent.call(this, obj.event, obj.params);
    } else {
        if (this.waitingCallbacks.length > 0) {
            var callback = this.waitingCallbacks.shift();
            if (typeof callback === 'function') {
                callback(obj);
            }
        }
    }
};

var handleEvent = function (event, parameters) {
    parameters.unshift(event);
    this.emit.apply(this, parameters);
};

var connected = function () {
    // Connected to DaZeus
    console.log("Connected");
};

var disconnected = function () {
    // Disconnected from DaZeus
    console.log("Disconnected");
};

var dazeusify = function (message) {
    var str = JSON.stringify(message);
    return str.length + str + "\r\n";
};

var dezeusify = function (message) {
    var objs = [];
    do {
        var length = '';
        message = message.trim();
        while (message.length > 0 && message[0] !== '{') {
            length += message[0];
            message = message.substr(1);
        }
        length = parseInt(length, 10);
        if (length > 0 && length <= message.length) {
            objs.push(JSON.parse(message.substr(0, length)));
            message = message.substr(length + 1);
        } else {
            break;
        }
    } while (true);
    return objs;
};

module.exports.connect = function (connectionData, onConnect) {
    return new DaZeus(connectionData, onConnect);
};
