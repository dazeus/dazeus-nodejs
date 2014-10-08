var net = require('net');
var EventEmitter = require('events').EventEmitter;
var sys = require('sys');
var strftime = require('prettydate').strftime;
var util = require('util');

/**
 * Implemented DaZeus protocol version
 * @type {Integer}
 */
var PROTOCOL_VERSION = 1;

/**
 * Regular expression for a nickname
 * @type {RegExp}
 */
var NICK_REGEX = /^[a-z_\-\[\]\\\^{}|`][a-z0-9_\-\[\]\\\^{}|`]*$/i;

/**
 * DaZeus client connection object
 * @param {Object} options
 * @param {Function} onConnect Function to be executed when the connection is established
 */
var DaZeus = function (options, onConnect) {
    var self = this;
    EventEmitter.call(this);

    this.options = options;

    // debugging
    this.debug_enabled = options.debug;
    this.handshook = false;

    // received data which could not be parsed into messages yet
    this.data = '';

    // determine correct call of net.connect
    var cb = function () {
        connected.call(self);
        onConnect.call(self);
    };

    if (options.path) {
        this.debug("Trying to establish connection to unix socket %s", options.path);
        this.client = net.connect(options.path, cb);
    } else {
        this.debug("Trying to establish connection to %s on port %s", options.host, options.port);
        this.client = net.connect(options.port, options.host, cb);
    }

    // when data is received
    this.client.on('data', function (data) {
        var obj = dezeusify.call(self, data.toString('utf8'));
        obj.forEach(function (item) {
            received.call(self, item);
        });
    });

    // when the connection is closed
    this.client.on('end', function () {
        disconnected.call(self);
    });

    this.client.on('error', function (err) {
        self.debug("Whoops, an error occurred: %s", err.message);
        throw new Error(util.format("A connection error occurred: %s", err.message));
    });

    // when a new listener is added to this object, we'll want to check if we should notify the server
    this.on('newListener', function (evt) {
        this.debug("A new event listener was added");
        if (evt.toUpperCase() === evt && !this.subscribedEvents.indexOf(evt) !== -1) {
            subscribeServerEvent.call(self, evt);
        }
    });

    this.subscribedEvents = [];
    this.waitingCallbacks = [];
};
sys.inherits(DaZeus, EventEmitter);

/**
 * Handshake with the server.
 * @param {String}   name       The name of this plugin
 * @param {String}   version    The version of the plugin
 * @param {String}   configname The section used for configuration (optional)
 * @param {Function} callback   Function to be executed with the result of the request (optional)
 */
DaZeus.prototype.handshake = function (name, version, configname, callback) {
    if (typeof configname === 'function') {
        callback = configname;
        configname = null;
    }

    if (typeof configname === 'undefined' || configname === null) {
        configname = name;
    }
    var self = this;
    sendReceive.call(this, {'do': 'handshake', params: [name, version, PROTOCOL_VERSION, configname]}, function () {
        self.handshook = true;
        if (typeof callback !== 'undefined' && callback !== null) {
            callback.apply();
        }
    });
};

/**
 * Retrieve a configuration value
 * @param  {String}   key
 * @param  {String}   group    Either 'plugin' or 'core'
 * @param  {Function} callback
 */
DaZeus.prototype.getConfig = function (key, group, callback) {
    if (typeof group === 'function') {
        callback = group;
        group = null;
    }

    if (typeof group === 'undefined' || group === null) {
        group = 'plugin'
    }

    sendReceive.call(this, {'get': 'config', params: [group, key]}, callback);
};

/**
 * Retrieve a property from the DaZeus database
 * @param  {String}   property Name of the property
 * @param  {Array}    scope    Scope identifier (optional)
 * @param  {Function} callback Function to be executed with the result of the request
 */
DaZeus.prototype.getProperty = function (property, scope, callback) {
    if (typeof scope === 'function') {
        callback = scope;
        scope = undefined;
        this.debug("Requesting property %s without scope", property);
    } else {
        this.debug("Requesting property %s with scope %s", property, JSON.stringify(scope));
    }

    if (typeof scope === 'undefined') {
        sendReceive.call(this, {'do': 'property', params: ['get', property]}, callback);
    } else {
        sendReceive.call(this, {'do': 'property', scope: scope, params: ['get', property]}, callback);
    }
};

/**
 * Set a property to some value.
 * @param {String}   property Name of the property
 * @param {Object}   value    Some value to store
 * @param {Array}    scope    Scope identifer (optional)
 * @param {Function} callback Function to be executed when the property change is processed
 */
DaZeus.prototype.setProperty = function (property, value, scope, callback) {
    if (typeof scope === 'function') {
        callback = scope;
        scope = undefined;
        this.debug("Setting property %s to %s without scope", property, JSON.stringify(value));
    } else {
        this.debug("Setting property %s to %s with scope %s", property, JSON.stringify(value), JSON.stringify(scope));
    }

    if (typeof scope === 'undefined') {
        sendReceive.call(this, {'do': 'property', params: ['set', property, value]}, callback);
    } else {
        sendReceive.call(this, {'do': 'property', scope: scope, params: ['set', property, value]}, callback);
    }
};

/**
 * Remove a property from the database of properties in DaZeus
 * @param  {String}   property Name of the property
 * @param  {Array}    scope    Scope identifer (optional)
 * @param  {Function} callback Function to be executed when the property change is processed
 */
DaZeus.prototype.unsetProperty = function (property, scope, callback) {
    if (typeof scope === 'function') {
        callback = scope;
        scope = undefined;
        this.debug("Removing property %s without scope", property);
    } else {
        this.debug("Removing property %s with scope %s", property, JSON.stringify(scope));
    }

    if (typeof scope === 'undefined') {
        sendReceive.call(this, {'do': 'property', params: ['unset', property]}, callback);
    } else {
        sendReceive.call(this, {'do': 'property', scope: scope, params: ['unset', property]}, callback);
    }
};

/**
 * Retrieve the keys starting with a given string from the database of properties in DaZeus
 * @param {String}   property Starting string of the properties
 * @param {Array}    scope    Scope identifier (optional)
 * @param {Function} callback Function to be executed with the results from the request
 */
DaZeus.prototype.propertyKeys = function (property, scope, callback) {
    if (typeof scope === 'function') {
        callback = scope;
        scope = undefined;
        this.debug("Retrieving properties starting with %s without scope", property);
    } else {
        this.debug("Retrieving properties starting with %s with scope %s", property, JSON.stringify(scope));
    }

    if (typeof scope === 'undefined') {
        sendReceive.call(this, {'do': 'property', params: ['keys', property]}, callback);
    } else {
        sendReceive.call(this, {'do': 'property', scope: scope, params: ['keys', property]}, callback);
    }
};

/**
 * Get a permission
 * @param  {String}   permission Name of the permission
 * @param  {Array}    scope      Scope identifer
 * @param  {Boolean}  defaultval Default permission if none was given
 * @param  {Function} callback   Callback to be executed with the result.
 */
DaZeus.prototype.getPermission = function (permission, scope, defaultval, callback) {
    if (typeof defaultval === 'function') {
        callback = defaultval;
        defaultval = false;
    }

    this.debug(
        "Checking permission %s in scope %s (default %s)",
        permission,
        JSON.stringify(scope),
        JSON.stringify(defaultval)
    );
    sendReceive.call(this, {'do': 'permission', scope: scope, params: ['get', permission, defaultval]}, callback);
};

/**
 * Set a permission
 * @param  {String}   permission Name of the permission
 * @param  {Array}    scope      Scope identifer
 * @param  {Boolean}  allow      Whether or not to allow or deny access (optional, default: true)
 * @param  {Function} callback   Function to be executed when the permission change is processed (optional)
 */
DaZeus.prototype.setPermission = function (permission, scope, allow, callback) {
    if (typeof allow === 'function') {
        callback = allow;
        allow = true;
    }

    if (typeof allow === 'undefined') {
        allow = true;
    }

    this.debug(
        "Setting permission %s in scope %s to %s",
        permission,
        JSON.stringify(scope),
        JSON.stringify(allow)
    );

    sendReceive.call(this, {'do': 'permission', scope: scope, params: ['set', permission, allow]}, callback);
};

/**
 * Remove a permission
 * @param  {String}   permission Name of the permission
 * @param  {Array}    scope      Scope identifer
 * @param  {Function} callback   Function to be executed when the permission change is processed
 */
DaZeus.prototype.unsetPermission = function (permission, scope, callback) {
    this.debug("Removing permission %s in scope %s", permission, JSON.stringify(scope));
    sendReceive.call(this, {'do': 'permission', scope: scope, params: ['unset', permission]}, callback);
};

/**
 * Send a message to a channel
 * @param  {String}   network  Name of the network where the message should go
 * @param  {String}   channel  Name of the channel where the message should go
 * @param  {String}   message  The message to be sent
 * @param  {Function} callback Callback to be executed when the message is sent
 */
DaZeus.prototype.message = function (network, channel, message, callback) {
    this.debug("Sending message to %s on %s: %s", channel, network, message);
    sendReceive.call(this, {'do': 'message', params: [network, channel, message]}, callback);
};

/**
 * Send a notice to a channel/user
 * @param {String}   network  Name of the network where the message should go
 * @param {String}   channel  Name of the channel/user where the message should go
 * @param {String}   message  The message to be sent
 * @param {Function} callback Callback to be executed when the message is sent
 */
DaZeus.prototype.notice = function (network, channel, message, callback) {
    this.debug("Sending notice to %s on %s: %s", channel, network, message);
    sendReceive.call(this, {'do': 'notice', params: [network, channel, message]}, callback);
};

/**
 * Send a CTCP request to a channel
 * @param {String}   network  Name of the network where the message should go
 * @param {String}   channel  Name of the channel where the message should go
 * @param {String}   message  The message to be sent
 * @param {Function} callback Callback to be executed when the message is sent
 */
DaZeus.prototype.ctcp = function (network, channel, message, callback) {
    this.debug("Sending notice to %s on %s: %s", channel, network, message);
    sendReceive.call(this, {'do': 'ctcp', params: [network, channel, message]}, callback);
};

/**
 * Send a CTCP reply to a channel
 * @param {String}   network  Name of the network where the message should go
 * @param {String}   channel  Name of the channel where the message should go
 * @param {String}   message  The message to be sent
 * @param {Function} callback Callback to be executed when the message is sent
 */
DaZeus.prototype.ctcpReply = function (network, channel, message, callback) {
    this.debug("Sending notice to %s on %s: %s", channel, network, message);
    sendReceive.call(this, {'do': 'ctcp_rep', params: [network, channel, message]}, callback);
};

/**
 * Send a CTCP action (/me) message to a channel.
 * @param  {String}   network  Name of the network where the message should go
 * @param  {String}   channel  Name of the channel where the message should go
 * @param  {String}   message  The message to be sent (without /me)
 * @param  {Function} callback Callback to be executed when the message is sent
 */
DaZeus.prototype.action = function (network, channel, message, callback) {
    this.debug("Sending ACTION to %s on %s: %s", channel, network, message);
    sendReceive.call(this, {'do': 'action', params: [network, channel, message]}, callback);
};

/**
 * Join a channel in a network
 * @param  {String}   network  Name of the network where the channel is located
 * @param  {String}   channel  Name of the channel to join
 * @param  {Function} callback Callback to be executed when the join request is processed
 */
DaZeus.prototype.join = function (network, channel, callback) {
    this.debug("Requesting to join %s on %s", channel, network);
    sendReceive.call(this, {'do': 'join', params: [network, channel]}, callback);
};

/**
 * Leave a channel in a network
 * @param  {String}   network  Name of the network where the channel is located
 * @param  {String}   channel  Name of the channel to leave
 * @param  {Function} callback Callback to be executed when the part request is processed
 */
DaZeus.prototype.part = function (network, channel, callback) {
    this.debug("Requesting to leave %s on %s", channel, network);
    sendReceive.call(this, {'do': 'part', params: [network, channel]}, callback);
};

/**
 * Request a list of names in a channel
 * @param  {String}   network  Name of the network where the channel is located
 * @param  {String}   channel  Name of the channel to request names
 * @param  {Function} callback Callback to be executed with the results of the request
 */
DaZeus.prototype.names = function (network, channel, callback) {
    this.debug("Requesting names for channel %s on %s", channel, network);
    var self = this;
    var cb = function (nw, addr, ch) {
        if (nw === network && ch === channel) {
            self.removeListener('NAMES', cb);
            var names = [];
            for (var i in arguments) {
                if (arguments.hasOwnProperty(i) && parseInt(i, 10) > 2) {
                    names.push(arguments[i]);
                }
            }
            callback(names, nw, ch);
        }
    };
    self.on('NAMES', cb);
    send.call(this, {'do': 'names', params: [network, channel]});
};

/**
 * Request a list of names in a channel, remove any prefixes
 * @param  {String}   network  Name of the network where the channel is located
 * @param  {String}   channel  Name of the channel to request names
 * @param  {Function} callback Callback to be executed with the results of the request
 */
DaZeus.prototype.nicknames = function (network, channel, callback) {
    this.names(network, channel, function (names, network, channel) {
        callback(names.map(function (name) {
            if (!NICK_REGEX.test(name)) {
                return name.substr(1);
            } else {
                return name;
            }
        }), network, channel);
    });
};

/**
 * Retrieve a list of networks that the bot is connected to
 * @param  {Function} callback Callback to be executed when the requested data is received
 */
DaZeus.prototype.networks = function (callback) {
    this.debug("Requesting list of connected networks");
    sendReceive.call(this, {'get': 'networks'}, callback);
};

/**
 * Retrieve a list of connected channels from a given network
 * @param  {String}   network  Name of the network
 * @param  {Function} callback Callback to be executed when the requested data is received
 */
DaZeus.prototype.channels = function (network, callback) {
    this.debug("Requesting list of connected channels in the network %s", network);
    sendReceive.call(this, {'get': 'channels', params: [network]}, callback);
};

/**
 * Receive the current nick of the bot on a given network
 * @param  {String}   network  Name of the network at which the nick should be retrieved
 * @param  {Function} callback Callback to be executed when the requested data is received
 */
DaZeus.prototype.nick = function (network, callback) {
    this.debug("Requesting nick of the bot on network %s", network);
    sendReceive.call(this, {'get': 'nick', params: [network]}, callback);
};

/**
 * Send a whois message for a user in a network
 * @param  {String}   network  Network where the user is located
 * @param  {String}   user     Name of the user to send a whois request for
 * @param  {Function} callback Callback to be executed when the requested data is received
 */
DaZeus.prototype.whois = function (network, user, callback) {
    this.debug("Requesting whois data for %s on %s", user, network);
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

/**
 * Reply to a message, automatically pick the correct channel for queries.
 * @param  {String}   network   The network to which the reply should be sent
 * @param  {String}   channel   The channel from which the original message got
 * @param  {String}   user      The user that sent the original message
 * @param  {String}   message   The reply message
 * @param  {Boolean}  highlight Whether or not to add a highlight for non-query chats
 * @param  {String}   type      What type of reply to send (message, notice, ctcp)
 * @param  {Function} callback  Function to be executed when the reply was sent
 */
DaZeus.prototype.reply = function (network, channel, user, message, highlight, type, callback) {
    var func = this.message, self = this;
    if (typeof type === 'function') {
        callback = type;
        type = 'message';
    }

    if (typeof highlight === 'function') {
        callback = highlight;
        highlight = false;
    }

    if (typeof highlight === 'string') {
        type = highlight;
        highlight = false;
    }

    if (typeof highlight === 'undefined') {
        highlight = false;
    }

    if (type === 'notice') {
        func = this.notice;
    } else if (type === 'ctcp') {
        func = this.ctcpReply;
    }

    this.nick(network, function (answer) {
        if (channel === answer.nick) {
            func.call(self, network, user, message, callback);
        } else {
            if (highlight) {
                message = user + ': ' + message;
            }
            func.call(self, network, channel, message, callback);
        }
    });
};

/**
 * Registers a command to the server, the callback will be notified every time that command is executed.
 * @param  {String}   command  Name of the command to register
 * @param  {String}   network  Optional: at what network the command should be registered
 * @param  {Function} callback Function to be executed when a command is requested
 */
DaZeus.prototype.onCommand = function (command, network, callback) {
    if (typeof network === 'function') {
        callback = network;
        network = undefined;
        this.debug("Registering command %s to all networks", command);
    } else {
        this.debug("Registering command %s to network %s", command, network);
    }

    if (network) {
        sendReceive.call(this, {'do': 'command', params: [command, network]});
    } else {
        sendReceive.call(this, {'do': 'command', params: [command]});
    }
    this.on('command_' + command, callback);
};

/**
 * Retrieve a configuration value
 * @param  {String}   name
 * @param  {String}   group
 * @param  {Function} callback
 */
DaZeus.prototype.getConfig = function (name, group, callback) {
    if (typeof group === 'undefined' || group === null) {
        group = 'plugin';
    }
    sendReceive.call(this, {'get': 'config', params: [group, name]}, callback);
};

/**
 * Retrieve the highlight character
 * @param  {Function} callback Callback that has the highlight character as the first argument
 */
DaZeus.prototype.highlightCharacter = function (callback) {
    this.getConfig('highlight', 'core', function (event) {
        callback(event.value);
    });
};

/**
 * Replace all occurences of {cmd} (case insensitive) with the command.
 * The command is prepended with the highlight character.
 * @param  {String}   string
 * @param  {String}   command
 * @param  {Function} callback
 */
DaZeus.prototype.insertCommand = function (string, command, callback) {
    this.highlightCharacter(function (chr) {
        var cmd = chr + command;
        callback(string.replace(/\{cmd\}/ig, cmd));
    });
};

/**
 * Close the connection, no future communication is possible.
 * @param {Function} callback To be executed when the connection is closed
 */
DaZeus.prototype.close = function (callback) {
    this.debug("Manual disconnect requested");
    if (typeof callback === 'function') {
        this.client.on('end', callback);
    }
    this.client.end();
};

/**
 * If debugging is enabled, print a debug message
 * @param  {String} message
 */
DaZeus.prototype.debug = function (message) {
    if (this.debug_enabled) {
        if (arguments.length > 1) {
            var params = [];
            for (var i in arguments) {
                if (arguments.hasOwnProperty(i)) {
                    params.push(arguments[i]);
                }
            }
            message = util.format.apply(null, params);
        }
        console.log(strftime(new Date(), "[%Y-%m-%dT%H:%M:%S] ") + message);
    }
};

/**
 * Sends some data to the server and calls a callback as soon as that is done.
 * @param  {Object}   data     Message to be sent
 * @param  {Function} callback Callback to be executed when sending is finished
 */
var send = function (data, callback) {
    this.debug("Sending: %s", JSON.stringify(data));
    var message = dazeusify.call(this, data);
    this.client.write(message, callback);
};

/**
 * Send a message and register a callback
 * @param  {Object}   data     Message to be sent
 * @param  {Function} callback Callback function to be registered
 */
var sendReceive = function (data, callback) {
    if (typeof callback !== 'function') {
        this.debug("Registering dummy callback, because a response message is expected");
    } else {
        this.debug("Registering callback");
    }
    this.waitingCallbacks.push(callback);
    send.call(this, data);
};

/**
 * Request DaZeus to be notified of a certain type of event
 * @param  {String} event Type of event to subscribe to
 */
var subscribeServerEvent = function (event) {
    this.debug("Requesting subscription for " + event);
    sendReceive.call(this, {'do': 'subscribe', params: [event]}, function (result) {
        if (result.success) {
            this.debug("Succesfully subscribed to %s", event);
        } else {
            this.debug("Subscription request for %s failed", event);
        }
    });
    this.subscribedEvents.push(event);
};

/**
 * Receive a new message object from the server.
 * Either we pass it off to the event-handler if it is an event-based object, or
 * we look for a corresponding callback that is waiting for a response.
 * @param  {Object} obj The received message as a javascript object
 */
var received = function (obj) {
    this.debug("Received: %s", JSON.stringify(obj));
    if (typeof obj.event !== 'undefined') {
        this.debug("Received an event-based message, sending off to listeners");
        handleEvent.call(this, obj.event, obj.params);
    } else {
        if (this.waitingCallbacks.length > 0) {
            var callback = this.waitingCallbacks.shift();
            if (typeof callback === 'function') {
                this.debug("Calling previously registered callback with message");
                callback.call(this, obj);
            } else {
                this.debug("Callback was a dummy, not calling");
            }
        } else {
            this.debug("No callbacks remaining, still received a response");
        }
    }
};

/**
 * For event-type messages, this calls the correct event handlers.
 * @param  {String} event     Event type name
 * @param  {Array} parameters Parameters for the event
 */
var handleEvent = function (event, parameters) {
    if (event === 'COMMAND') {
        event = 'command_' + parameters[3];
    }
    parameters.unshift(event);
    this.emit.apply(this, parameters);
};

/**
 * Function that is called when a connection is established
 */
var connected = function () {
    this.debug("Connected");
};

/**
 * Function that is called when the connection is closed.
 */
var disconnected = function () {
    this.debug("Disconnected");
};

/**
 * Transform an object to a string suitable for sending to DaZeus
 * @param  {Object} message
 * @return {String}
 */
var dazeusify = function (message) {
    var str = JSON.stringify(message);

    return Buffer.byteLength(str, 'utf8') + str + "\r\n";
};

/**
 * Transform a string retrieved from DaZeus to it's javascript-object-equivalents.
 * @param  {String} message
 * @return {Array} Array of parsed messages
 */
var dezeusify = function (message) {
    var objs = [], collector = '', chr, msglen, data;

    this.data += message;
    data = new Buffer(this.data, 'utf8');

    for (var i = 0; i < data.length; i += 1) {
        chr = data[i];
        if (chr > 47 && chr < 58) {
            collector += String.fromCharCode(chr);
        } else if (chr !== 10 && chr !== 13) {
            msglen = parseInt(collector, 10);

            if (msglen + i <= data.length) {
              objs.push(JSON.parse(data.toString('utf8', i, msglen + i)));
              data = data.slice(i + msglen);
              collector = '';
              i = 0;
            } else {
              break;
            }
        }
    }
    this.data = data.toString('utf8');
    return objs;
};

/**
 * Create a new connection to an instance of DaZeus
 * Available options are path, host, port and debug.
 * @param  {Object} options
 * @param  {Function} onConnect Callback when a connection is established
 * @return {DaZeus} DaZeus client connection object
 */
module.exports.connect = function (options, onConnect) {
    return new DaZeus(options, onConnect);
};
