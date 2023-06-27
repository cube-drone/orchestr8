#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parse, stringify } = require('yaml');
const { runCommandFromArgsIfArgsExist } = require('@cube-drone/rundmc');

const configYmlLocations = [process.env.ORCHESTR8_CONFIG_YML_LOCATION, "./config.yml", path.join(process.cwd(), 'config.yml'), "/var/config.yml", path.join(os.homedir(), ".orchestr8.yml")];
console.log(`pwd is ${process.cwd()}, looking for config.yml in ${configYmlLocations.join(", ")}`)
let config = {};
for( let configLocation of configYmlLocations ){
    if(fs.existsSync(configLocation)){
        console.log(`loading config from ${configLocation}`)
        let configYml = fs.readFileSync(configLocation, 'utf8')
        config = parse(configYml)
    }
}

// we need nodeEnv to be either "development" or "production"
//      if it is set to "development" a whole lot of security features are disabled to make testing and dev easier
//      (you must never use "development" in production, it'll let baddies do all kinds of nasty things)
config.nodeEnv = process.env.NODE_ENV ||
    config.nodeEnv ||
    config.NODE_ENV ||
    "development";

config.configTest = process.env.ORCHESTR8_CONFIG_TEST ||
    config.configTest ||
    config.CONFIG_TEST;

if(config.configTest){
    console.warn(`configTest is set to "${config.configTest}"!`);
}
else{
    console.warn(`configTest is not set!`);
}

// this is the fqdn of the server running orchestr8
config.hostName = process.env.ORCHESTR8_HOST_NAME ||
    process.env.HOST_NAME ||
    config.hostName ||
    config.HOST_NAME ||
    "localhost";

config.envPort = process.env.ORCHESTR8_PORT ||
    process.env.PORT ||
    config.port ||
    config.PORT ||
    9494;

// the cookieSecret is used to sign cookies, it should be a long random string
//    I don't think the cookie secret is actually used by orchestr8.
//    (at least at time of writing we don't set any cookies)
config.cookieSecret = process.env.ORCHESTR8_SECRET ||
    process.env.COOKIE_SECRET ||
    config.cookieSecret ||
    config.COOKIE_SECRET ||
    "toots ahoy";

// the postgres database is used to store records about the current state of the system - deploy history and the like
//    but, more than that, we're assuming that any child containers will need their own database
//    so when we deploy a container we create a new database on this postgres instance for it to use
//    (we don't do this if the container has a database url specified, but we do if it doesn't)
config.postgresConnectionString = process.env.ORCHESTR8_POSTGRES_URL ||
    process.env.POSTGRES_URL ||
    config.postgresConnectionString ||
    config.postgresUrl ||
    config.POSTGRES_URL ||
    "postgres://postgres:example@localhost:5432/orchestr8";

// the reason we need this: we need to be able to connect to the postgres database from within a container
//    and the fqdn of the postgres database within the orchestr8 network is just the name of the container
//    so when we create internal connections to the postgres database we use this name
config.postgresContainerName =
    process.env.ORCHESTR8_POSTGRES_CONTAINER_NAME ||
    config.postgresContainerName ||
    config.POSTGRES_CONTAINER_NAME ||
    "orchestr8_postgres_1";

// we automatically deploy containers and then point a nginx load balancer at the set that's currently active
//    this involves a lot of randomly selected ports - we need to know what range of ports we can use
//    so anything in this range is fair game
config.minPort = process.env.ORCHESTR8_MIN_PORT ||
    config.minPort ||
    config.MIN_PORT ||
    12000;
config.minPort = parseInt(config.minPort)
config.maxPort = process.env.ORCHESTR8_MAX_PORT ||
    config.maxPort ||
    config.MAX_PORT ||
    13000;
config.maxPort = parseInt(config.maxPort)

// we don't actually use this yet, but theoretically we know how much memory redis and node containers that we're standing up will
//    need, so we can use this to make sure we don't overcommit.
//    (as of right now we set the cap but don't respect it)
//    of course, we don't _actually_ know how much memory a container will need or use - but we know where the caps are
//    (we could theoretically run dozens of node and redis processes, more than we have memory for, and just hope they don't all use their max)
//    (welcome to OOM city)
config.memoryCap = process.env.MEMORY_CAP ||
    config.memoryCap ||
    config.MEMORY_CAP ||
    8192;
config.memoryCap = parseInt(config.memoryCap)

// we need to know where the docker socket is so we can talk to docker
config.dockerSocketPath = process.env.ORCHESTR8_DOCKER_SOCKET_PATH ||
    config.dockerSocketPath ||
    config.DOCKER_SOCKET_PATH ||
    "/var/run/docker.sock";

// you probably won't need to change these
//    the idea is, we're pulling npm packages from the fake npm set up at github's package registry
//    so we need to know where that is
config.npmGitApiUrl = process.env.ORCHESTR8_NPM_GIT_API_URL ||
    config.npmGitApiUrl ||
    config.NPM_GIT_API_URL ||
    "https://api.github.com";
config.npmRegistryUrl = process.env.ORCHESTR8_NPM_REGISTRY_URL ||
    config.npmRegistryUrl ||
    config.NPM_REGISTRY_URL ||
    "https://npm.pkg.github.com";
// and also, if we have private packages, we need to be able to authenticate to the package registry
//    this is _way_ easier to set up directly using environment variables or config,
//    but if you don't set it, we'll look for the token in your ~/.npmrc file
//    NODE_AUTH_TOKEN is also set automatically in GitHub Actions' CI environment
config.npmRegistryToken = process.env.NODE_AUTH_TOKEN ||
    process.env.ORCHESTR8_NPM_REGISTRY_TOKEN ||
    config.npmRegistryToken ||
    config.NPM_REGISTRY_TOKEN;

// this webhook is a http endpoint that takes a JSON {"text": "some text"} and posts it to ... somewhere
//    (in my set-up, it posts to a discourse channel, but you can point it at whatever you want)
//    it will be sent updates on how orchestr8 is doing, you know, emotional check-ins and support and the like
//    if left blank we'll just save that stuff for the console
config.webhookUrl = process.env.ORCHESTR8_WEBHOOK_URL ||
    config.webhookUrl ||
    config.webhook ||
    config.webHook ||
    config.WEBHOOK_URL;

config.alertWebhookUrl = process.env.ORCHESTR8_ALERT_WEBHOOK_URL ||
    config.alertWebhookUrl ||
    config.alertWebhook ||
    config.alertWebHook ||
    config.webhookUrl;

config.infoWebhookUrl = process.env.ORCHESTR8_INFO_WEBHOOK_URL ||
    config.infoWebhookUrl ||
    config.infoWebhook ||
    config.infoWebHook ||
    config.webhookUrl;

config.forget = process.env.ORCHESTR8_FORGET ||
    config.forget ||
    config.FORGET ||
    false;

// take arguments and do various tasks:
// * start the server
// * setup the database
// * run tests

// if npmRegistryToken is not set, we may be able to load it from .npmrc
if(!config.npmRegistryToken){
    try {
        const npmrcPath = path.join(os.homedir(), ".npmrc");
        const npmrc = fs.readFileSync(npmrcPath, 'utf8');
        const npmrcLines = npmrc.split("\n");
        let registryMatch = config.npmRegistryUrl.replace(/https?:/, "")
        for(let i=0; i<npmrcLines.length; i++){
            let line = npmrcLines[i];
            if(line.startsWith(registryMatch)){
                config.npmRegistryToken = line.split("=")[1];
				config.npmRegistryToken = config.npmRegistryToken.trim();
                break;
            }
        }
    } catch (err) {
        console.error("Error trying to load npm registry token from .npmrc");
        console.error(err)
        process.exit(1);
    }
}
if(!config.npmRegistryToken){
    console.error("Error: npm registry token not set");
    console.error("Please set the environment variable NODE_AUTH_TOKEN or set it in your .npmrc file");
    process.exit(1);
}

let { main, setup } = require('./index')

if(config.configTest){
    console.log("configTest is set, dumping config:")
    console.dir(config)
}

require('./Jakefile')

runCommandFromArgsIfArgsExist()
    .then(() => {
        return setup(config)
    })
    .then(()=>{
        return main(config)
    })
    .catch((err) => {
        console.error(err)
        process.exit(1)
    })