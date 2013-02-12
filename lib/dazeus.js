require('./util');
require('js-methods');
var net = require('net');
var EventEmitter = require('events').EventEmitter;
var sys = require('sys');
var optimist = require('optimist');
var strftime = require('prettydate').strftime;

/**
 * Default socket location if none is given.
 * @type {String}
 */
var DEFAULT_SOCKET = '/tmp/dazeus.sock';

/**
 * DaZeus client connection object
 * @param {Object} options
 * @param {Function} onConnect Function to be executed when the connection is established
 */
var DaZeus = function (options, onConnect) {
    var self = this;
    EventEmitter.call(this);

    // debugging
    this.debug_enabled = options.debug;

    // determine correct call of net.connect
    var cb = function () {
        connected.call(self);
        onConnect.call(self);
    };

    if (options.path) {
        this.debug("Trying to establish connection to unix socket " + options.path);
        this.client = net.connect(options.path, cb);
    } else {
        this.debug("Trying to establish connection to " + options.host + " on port " + options.port);
        this.client = net.connect(options.port, options.host, cb);
    }

    // when data is received
    this.client.on('data', function (data) {
        var obj = dezeusify.call(this, data);
        obj.forEach(function (item) {
            received.call(self, item);
        });
    });

    // when the connection is closed
    this.client.on('end', function () {
        disconnected.call(self);
    });

    // when a new listener is added to this object, we'll want to check if we should notify the server
    this.on('newListener', function (evt) {
        this.debug("A new event listener was added");
        if (evt.isUpperCase() && !this.subscribedEvents.contains(evt)) {
            subscribeServerEvent.call(self, evt);
        }
    });

    this.subscribedEvents = [];
    this.waitingCallbacks = [];
};
sys.inherits(DaZeus, EventEmitter);

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
        this.debug("Requesting property " + property + " without scope");
    } else {
        this.debug("Requesting property " + property + " with scope " + JSON.stringify(scope));
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
        this.debug("Setting property " + property + " to " + JSON.stringify(value) + " without scope");
    } else {
        this.debug("Setting property " + property + " to " + JSON.stringify(value) + " with scope " + JSON.stringify(scope));
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
        this.debug("Removing property " + property + " without scope");
    } else {
        this.debug("Removing property " + property + " with scope " + JSON.stringify(scope));
    }

    if (typeof scope === 'undefined') {
        sendReceive.call(this, {'do': 'property', params: ['unset', property]}, callback);
    } else {
        sendReceive.call(this, {'do': 'property', scope: scope, params: ['unset', property]}, callback);
    }
};

/**
 * Send a message to a channel
 * @param  {String}   network  Name of the network where the message should go
 * @param  {String}   channel  Name of the channel where the message should go
 * @param  {String}   message  The message to be sent
 * @param  {Function} callback Callback to be executed when the message is sent
 */
DaZeus.prototype.message = function (network, channel, message, callback) {
    this.debug("Sending message to " + channel + " on " + network + ": " + message);
    sendReceive.call(this, {'do': 'message', params: [network, channel, message]}, callback);
};

/**
 * Send a CTCP action (/me) message to a channel.
 * @param  {String}   network  Name of the network where the message should go
 * @param  {String}   channel  Name of the channel where the message should go
 * @param  {String}   message  The message to be sent (without /me)
 * @param  {Function} callback Callback to be executed when the message is sent
 */
DaZeus.prototype.action = function (network, channel, message, callback) {
    this.debug("Sending ACTION to " + channel + " on " + network + ": " + message);
    sendReceive.call(this, {'do': 'action', params: [network, channel, message]}, callback);
};

/**
 * Join a channel in a network
 * @param  {String}   network  Name of the network where the channel is located
 * @param  {String}   channel  Name of the channel to join
 * @param  {Function} callback Callback to be executed when the join request is processed
 */
DaZeus.prototype.join = function (network, channel, callback) {
    this.debug("Requesting to join " + channel + " in " + network);
    sendReceive.call(this, {'do': 'join', params: [network, channel]}, callback);
};

/**
 * Leave a channel in a network
 * @param  {String}   network  Name of the network where the channel is located
 * @param  {String}   channel  Name of the channel to leave
 * @param  {Function} callback Callback to be executed when the part request is processed
 */
DaZeus.prototype.part = function (network, channel, callback) {
    this.debug("Requesting to leave " + channel + " in " + network);
    sendReceive.call(this, {'do': 'part', params: [network, channel]}, callback);
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
    this.debug("Requesting list of connected channels in the network " + network);
    sendReceive.call(this, {'get': 'channels', params: [network]}, callback);
};

/**
 * Receive the current nick of the bot on a given network
 * @param  {String}   network  Name of the network at which the nick should be retrieved
 * @param  {Function} callback Callback to be executed when the requested data is received
 */
DaZeus.prototype.nick = function (network, callback) {
    this.debug("Requesting nick of the bot on network " + network);
    sendReceive.call(this, {'get': 'nick', params: [network]}, callback);
};

/**
 * Send a whois message for a user in a network
 * @param  {String}   network  Network where the user is located
 * @param  {String}   user     Name of the user to send a whois request for
 * @param  {Function} callback Callback to be executed when the requested data is received
 */
DaZeus.prototype.whois = function (network, user, callback) {
    this.debug("Requesting whois data for " + user + " on " + network);
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
 * @param  {Function} callback  Function to be executed when the reply was sent
 */
DaZeus.prototype.reply = function (network, channel, user, message, highlight, callback) {
    var self = this;
    if (typeof highlight === 'function') {
        callback = highlight;
        highlight = true;
    }

    if (typeof highlight === 'undefined') {
        highlight = true;
    }

    this.nick(network, function (answer) {
        if (channel === answer.nick) {
            self.message(network, user, message, callback);
        } else {
            if (highlight) {
                message = user + ': ' + message;
            }
            self.message(network, channel, message, callback);
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
        this.debug("Registering command " + command + " to all networks");
    } else {
        this.debug("Registering command " + command + " to network " + network);
    }

    if (network) {
        sendReceive.call(this, {'do': 'command', params: [command, network]});
    } else {
        sendReceive.call(this, {'do': 'command', params: [command]});
    }
    this.on('command_' + command, callback);
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
        console.log(strftime(new Date(), "[%Y-%m-%dT%H:%M:%S] ") + message);
    }
};

/**
 * Sends some data to the server and calls a callback as soon as that is done.
 * @param  {Object}   data     Message to be sent
 * @param  {Function} callback Callback to be executed when sending is finished
 */
var send = function (data, callback) {
    this.debug("Sending: " + JSON.stringify(data));
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
            this.debug("Succesfully subscribed to " + event);
        } else {
            this.debug("Subscription request for " + event + " failed");
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
    this.debug("Received: " + JSON.stringify(obj));
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
    var objs = [], collector = '', chr, msglen;

    for (var i = 0; i < message.length; i += 1) {
        chr = message[i];
        if (chr > 47 && chr < 58) {
            collector += String.fromCharCode(chr);
        } else if (chr !== 10 && chr !== 13) {
            msglen = parseInt(collector, 10);
            collector = '';

            objs.push(JSON.parse(message.toString('utf8', i, i + msglen)));

            i += msglen;
        }
    }
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

/**
 * Takes an options array as parsed by optimist processes it for dazeus-nodejs
 * @param  {Object} argv
 * @return {Object}
 */
module.exports.optionsFromArgv = function (argv) {
    var options = {};
    if (typeof argv.path === 'string') {
        options.path = argv.path;
    } else if (typeof argv.host === 'string' && typeof argv.port === 'number') {
        options.host = argv.host;
        options.port = argv.port;
    } else {
        options.path = DEFAULT_SOCKET;
    }

    options.debug = false;
    if (argv.debug) {
        options.debug = true;
    }
    return options;
};

/**
 * Creates command line options used by dazeus-nodejs.
 * @return {Argv} Optimist's Argv object
 */
module.exports.optimist = function () {
    return optimist
        .usage("Usage: $0")
        .boolean("debug")
        .string("path")
        .string("host")
        .boolean("help")
        .alias("path", "f")
        .alias("host", "h")
        .alias("port", "p")
        .alias("debug", "d")
        .describe("path", "Path of a DaZeus unix socket, only required if no port and host are provided")
        .describe("host", "Host where a DaZeus instance accepts TCP connections")
        .describe("port", "Port corresponding to the given host")
        .describe("debug", "Let dazeus-nodejs display debug messages")
        .describe("help", "Display this help message");
};

/**
 * Show the help message if the provided arguments require it
 * @param {Argv} argv Optimist's Argv object
 */
module.exports.help = function (argv) {
    if (argv.help) {
        optimist.showHelp();
        process.exit();
    }
};

/**
 * Helper function for reading the contents of a file into an array
 * @param  {String} file Name of the file
 * @return {Array}       Data in the file
 */
module.exports.readFile = function (file) {
    var fs = require('fs');
    return fs.readFileSync(file).toString().split("\n").filter(function (element) {
        return element.trim().length > 0;
    });
};

/**
 * Helper function for writing the contents of an array to a file
 * @param  {String} file The file the data should be written to
 * @param  {Array}  data The data to be written away
 */
module.exports.writeFile = function (file, data) {
    var fs = require('fs');
    var stream = fs.createWriteStream(file, {flags: 'w'});
    for (var i in data) {
        if (data.hasOwnProperty(i)) {
            if (typeof data[i] === 'string') {
                stream.write(data[i] + "\n");
            }
        }
    }
    stream.end();
};

/**
 * Determine whether or not a string is in a file (on a separate line)
 * @param  {String} file The name of the file where the string is located
 * @param  {String} str  The string to check for
 * @return {Boolean}     True of the string is in the file, false if it isn't
 */
module.exports.existsIn = function (file, str) {
    if (typeof file === 'string') {
        file = module.exports.readFile(file);
    }
    for (var i in file) {
        if (file.hasOwnProperty(i)) {
            if (file[i].trim() === str.trim()) {
                return true;
            }
        }
    }
    return false;
};

/**
 * Retrieve a random line from a file
 * @param  {String} file Name of the file to retrieve contents from
 * @return {String}      A random line from the file
 */
module.exports.randomFrom = function (file) {
    var array = module.exports.readFile(file);
    return array[Math.floor(Math.random() * array.length)];
};

/**
 * Remove the line matching the given string from the file
 * @param  {String} file Name of the file where the item could be located
 * @param  {String} str  The string to remove
 * @return {Boolean}     True of the item was removed, false if it wasn't there.
 */
module.exports.removeFrom = function (file, str) {
    var array = module.exports.readFile(file);
    if (!module.exports.existsIn(array, str)) {
        return false;
    } else {
        array = array.filter(function (elem) {
            return elem.trim() !== str.trim();
        });
        module.exports.writeFile(file, array);
        return true;
    }
};

/**
 * Add a string to a file in a new line
 * @param  {String} file The name of the file where the string should be written to
 * @param  {String} str  The string to append
 * @return {Boolean}     True of the string was appended, false if it already existed
 */
module.exports.appendTo = function (file, str) {
    var array = module.exports.readFile(file);
    if (module.exports.existsIn(file, str)) {
        return false;
    } else {
        array.push(str);
        module.exports.writeFile(file, array);
        return true;
    }
};

/**
 * Given the argument string from a command, this returns the first word, and the remainder in an array
 * @param  {String} args The arguments where a split on the first command is required
 * @return {Array}       An array containing under index 0 the first argument, and under index 1 the rest of the string.
 */
module.exports.firstArgument = function (args) {
    var first = args.split(/\s+/, 1).toString();
    var rest = args.trim().substr(first.length).trim();
    return [first, rest];
};

/**
 * Run through a list of commands and check if those are the first arguments provided in the argument string.
 * If a command matches, then the yesCallback is executed, otherwise, the (optional) noCallback is executed.
 * The command may also be a string, then only one check is executed. If a match is found and the yesCallback
 * is executed, the remainder of argumetns will be used for the first parameter, if no match is found the
 * noCallback is executed with the original args input string. Some examples:
 *
 *     // this would execute the yesCallback with the remaining argument 'this world'
 *     isCommand('build', 'build this world', function () { ... });
 *
 *     // this would not execute anything
 *     isCommand('build', 'destroy this world', function () { ... });
 *
 *     // this would execute the yesCallback with the remaining argument 'house'
 *     isCommand(['build', 'a'], 'build a house', function () { ... });
 *
 *     // this would execute the noCallback with the original arguments
 *     isCommand(['build', 'a'], 'build the world', function () { ... }, function () { ... });
 *
 * @param  {Array}     command     The commands to check for
 * @param  {String}    args        Arguments to check on
 * @param  {Function}  yesCallback Callback to execute for a successful match
 * @param  {Function}  noCallback  Callback to execute for an unsuccessful match
 */
module.exports.isCommand = function (command, args, yesCallback, noCallback) {
    if (typeof command === 'string') {
        command = [command];
    }
    var originalArgs = args;
    var accept = true;
    while (command.length > 0) {
        var next = command.shift();
        var argsplit = module.exports.firstArgument(args);
        if (argsplit[0].trim() === next.trim()) {
            args = argsplit[1];
        } else {
            accept = false;
            break;
        }
    }

    if (accept && typeof yesCallback === 'function') {
        yesCallback.call(this, args);
    } else if (!accept && typeof noCallback === 'function') {
        noCallback.call(this, originalArgs);
    }
};
