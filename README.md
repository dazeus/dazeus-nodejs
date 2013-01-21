# DaZeus Node.js Bindings
This package provides bindings for the DaZeus IRC Bot

## Getting started
Here's an example echobot, that just repeats every message back to the channel

    var dazeus = require("./lib/dazeus");
    var client = dazeus.connect({path: '/tmp/dazeus.sock'}, function () {
        client.on('PRIVMSG', function (network, user, channel, message) {
            client.message(network, channel, message);
        });
    });

