const express = require('express')
const crypto = require('crypto')
require('express-async-errors') // this patches better async error handling into express
const app = express()
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const morgan = require('morgan')
const assert = require('assert')
const axios = require('axios')

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

    let extraEnv = {
        INFO_WEBHOOK_URL: infoWebhookUrl,
        ALERT_WEBHOOK_URL: alertWebhookUrl,
    }

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
        extraEnv,
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

    let { run } = require('@cube-drone/rundmc');
    await run('docker pull node:20')
    await run('docker pull nginx:alpine')
    await run('docker pull redis:alpine')

    let {connectAndSetup} = require('./database-setup')
    let sqlDatabase = await connectAndSetup({postgresConnectionString})

    console.log(`\trunning migrations...`);

    // HEY! ME!
    // If you don't do this next part exactly right, you won't be able to run
    //  migrations when you launch this app as an npx module:
    let thisPath = require.resolve("./knexfile.js");
    thisPath = thisPath.substring(0, thisPath.length - "knexfile.js".length)
    // join thispath and ./migrations
    console.log(`looking for migrations on path ${thisPath}`)
    let migrationsPath = require('path').join(thisPath, "migrations")

    await sqlDatabase.migrate.latest({
        directory: migrationsPath,
    })
    let currentVersion = await sqlDatabase.migrate.currentVersion();
    console.warn(`\tcurrent version: ${currentVersion}`);
}

module.exports = {
    main,
    setup
}