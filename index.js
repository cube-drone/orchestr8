const express = require('express')
const crypto = require('crypto')
require('express-async-errors') // this patches better async error handling into express
const app = express()
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const morgan = require('morgan')
const assert = require('assert')
const axios = require('axios')

const { Redis } = require("ioredis")

const jsonParser = bodyParser.json()
const urlencodedParser = bodyParser.urlencoded({ extended: false })

//--------------------------
async function main({
    nodeEnv,
    hostName,
    envPort,
    cookieSecret,
    postgresConnectionString,
    postgresContainerName,
    minPort,
    maxPort,
    memoryCap,
    dockerSocketPath,
    npmGitApiUrl,
    npmRegistryUrl,
    npmRegistryToken,
    alertWebhookUrl,
    infoWebhookUrl,
    deploys,            // if it exists, this is a YAML object describing all of the deployments we're expected to watch
    forget,             // if true, we will forget all of the deployment history (this should force redeployment of everything)
}){

    let alert = console.error;
    if(alertWebhookUrl){
        alert = async (message) => {
            await axios.post(alertWebhookUrl, {text: message})
        }
    }
    let info = console.log;
    if(infoWebhookUrl){
        info = async (message) => {
            await axios.post(infoWebhookUrl, {text: message})
        }
    }

    info(`Starting orchestr8 on ${hostName}:${envPort} in ${nodeEnv} mode`);

    app.use(cookieParser(cookieSecret))

    // we are going to deploy this behind nginx
    app.set('trust proxy', true)
    // log stuff
    app.use(morgan('tiny'))

    const sqlDatabase = require('knex')({
        client: 'pg',
        connection: postgresConnectionString
    });

    const deployModel = require('./models/deploy')({
        nodeEnv,
        hostName,
        cookieSecret,
        sqlDatabase,
        postgresConnectionString,
        postgresContainerName,
        minPort,
        maxPort,
        memoryCap,
        dockerSocketPath,
        npmGitApiUrl,
        npmRegistryUrl,
        npmRegistryToken,
        deploys,
        alert,
        info,
    })

    await deployModel.createData({deploys})
    if(forget){
        await deployModel.forgetAll()
    }

    setInterval(deployModel.reconcile, 1000*60) // every minute
    setImmediate(deployModel.reconcile)

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
        assert.strictEqual(pong, "toots ahoy")

        res.send("orchestr8 :)")
    })

    app.get('/', async function (req, res) {
        let deployments = await deployModel.getStatusReport()
        res.json(deployments)
    })

    app.listen(envPort)
    console.log(`Listening on port ${envPort}...`)

}

async function setup({postgresConnectionString}){
    /*
        it makes sure that a database table exists for this applicaiton,
        and then runs any knex migrations that are needed
    */
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