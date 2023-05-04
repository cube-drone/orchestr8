const assert = require('assert');
const axios = require('axios');
const {http} = require('./common');

describe('Test the foo system', async function () {

    describe('http works', async function () {
        it('ping', async function () {
            let response = await http.get('/ping')
            assert.strictEqual(response.data, "pong")
        });
        it('connects to databases and such', async function () {
            let response = await http.get('/test')
            assert.strictEqual(response.data, ":)")
        });
    });

})
