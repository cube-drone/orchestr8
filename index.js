const express = require('express')
const crypto = require('crypto')
require('express-async-errors') // this patches better async error handling into express
const app = express()
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const morgan = require('morgan')
const assert = require('assert')

const { Redis } = require("ioredis")

const jsonParser = bodyParser.json()
const urlencodedParser = bodyParser.urlencoded({ extended: false })

//--------------------------
async function main({nodeEnv, envPort, cookieSecret, redisUrl, postgresConnectionString}){
    app.use(cookieParser(cookieSecret))

    // we are going to deploy this behind nginx
    app.set('trust proxy', true)
    // log stuff
    app.use(morgan('tiny'))

    const sqlDatabase = require('knex')({
        client: 'pg',
        connection: postgresConnectionString
    });  
    const redis = new Redis(redisUrl);

    let noopMiddleware = async (req, res, next) => {
        next()
    }

    // error handler
    app.use((err, req, res, next) => {
        console.error(err.stack)
        let errorMessage = err.message;
        if(nodeEnv === "production"){
            errorMessage = "Internal Server Error"
        }
        res.status(500).send(errorMessage)
    })

    //---------------------------

    app.get('/ping', function (req, res) {
        res.send('pong')
    })

    app.get('/test', async function (req, res) {
        await redis.set("ponk", "toots ahoy", "EX", 60*60*24*7)
        let pong = await redis.get("ponk")
        assert.strictEqual(pong, "toots ahoy")

        await sqlDatabase('table_1').insert({
            id: crypto.randomUUID(),
            name: "toots ahoy"
        })
        res.send(":)")
    })

    app.listen(envPort)
    console.log(`Listening on port ${envPort}...`)
}

async function setup({nodeEnv, envPort, redisUrl, postgresConnectionString}){
    /*
        this is run once, during a deploy
    */
    const redis = new Redis(redisUrl);

    let lock = await redis.set("setup-lock", "1", "NX", "EX", 30)
    if(!lock){
        return;
    }

    let {connectAndSetup} = require('./database-setup')
    let sqlDatabase = await connectAndSetup({postgresConnectionString})

    console.log(`\trunning migrations...`);
    await sqlDatabase.migrate.latest({
        directory: './migrations',
    })
    let currentVersion = await sqlDatabase.migrate.currentVersion();
    console.warn(`\tcurrent version: ${currentVersion}`);
}

module.exports = {
    main,
    setup
}