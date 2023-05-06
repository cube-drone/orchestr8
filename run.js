let { main } = require('./index')

const nodeEnv = process.env.NODE_ENV || "development";
const hostName = process.env.ORCHESTR8_HOST_NAME || process.env.HOST_NAME || 
    "groovelet.local";
const envPort = process.env.ORCHESTR8_PORT || 9494;
const cookieSecret = process.env.ORCHESTR8_SECRET || "toots ahoy";
const redisUrl = process.env.ORCHESTR8_REDIS_URL || process.env.REDIS_URL || 
    "redis://localhost:6379";
const postgresConnectionString = process.env.ORCHESTR8_POSTGRES_URL || process.env.POSTGRES_URL || 
    "postgres://postgres:example@localhost:5432/orchestr8";
// the range between minPort and maxPort will be used for deployments
let minPort = process.env.ORCHESTR8_MIN_PORT || 12000;
minPort = parseInt(minPort)
let maxPort = process.env.ORCHESTR8_MAX_PORT || 13000;
maxPort = parseInt(maxPort)
let memoryCap = process.env.MEMORY_CAP || 8192;
memoryCap = parseInt(memoryCap)
const dockerSocketPath = process.env.ORCHESTR8_DOCKER_SOCKET_PATH || "/var/run/docker.sock";
const npmGitApiUrl = process.env.ORCHESTR8_NPM_GIT_API_URL || "https://api.github.com";
const npmRegistryUrl = process.env.ORCHESTR8_NPM_REGISTRY_URL || "https://npm.pkg.github.com";
let npmRegistryToken = process.env.NODE_AUTH_TOKEN;

// take arguments and do various tasks:
// * start the server
// * setup the database
// * run tests

// if npmRegistryToken is not set, we may be able to load it from .npmrc
if(!npmRegistryToken){
    try {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const npmrcPath = path.join(os.homedir(), ".npmrc");
        const npmrc = fs.readFileSync(npmrcPath, 'utf8');
        const npmrcLines = npmrc.split("\n");
        let registryMatch = npmRegistryUrl.replace(/https?:/, "")
        for(let i=0; i<npmrcLines.length; i++){
            let line = npmrcLines[i];
            if(line.startsWith(registryMatch)){
                npmRegistryToken = line.split("=")[1];
                break;
            }
        }
    } catch (err) {
        console.error("Error trying to load npm registry token from .npmrc");
        console.error(err)
        process.exit(1);
    }
}
if(!npmRegistryToken){
    console.error("Error: npm registry token not set");
    console.error("Please set the environment variable NODE_AUTH_TOKEN or set it in your .npmrc file");
    process.exit(1);
}

main({
    nodeEnv,
    hostName, 
    envPort, 
    cookieSecret, 
    redisUrl, 
    postgresConnectionString,
    minPort,
    maxPort,
    memoryCap,
    dockerSocketPath,
    npmGitApiUrl,
    npmRegistryToken,
    npmRegistryUrl    
    }).catch((err) => {
    console.error(err)
    process.exit(1)
})