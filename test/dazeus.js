var should = require('should');
var dazeus = require('../lib/dazeus');

describe('dazeus', function () {
    describe('when connecting via a non-existing unix socket', function () {
        it('gives an error', function () {
            var server = dazeus.connect('/tmp/dazeus.socket');
        });
    });
});
