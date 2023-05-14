const {Docker} = require('node-docker-api');
const axios = require('axios');
const delay = require('delay');
const { Redis } = require("ioredis")
const assert = require("assert");
const { connectAndSetup, connectionStringChangeDatabase } = require('../database-setup');

module.exports = ({
    nodeEnv="development", 
    hostName,
    cookieSecret,
    postgresConnectionString,
    postgresContainerName,
    sqlDatabase, 
    redis, 
    minPort=12000,
    maxPort=13000,
    memoryCap=8192,
    npmGitApiUrl,
    npmRegistryUrl='https://npm.pkg.github.com',
    npmRegistryToken,
    dockerSocketPath='/var/run/docker.sock'}) => {
    
    let docker = new Docker({ socketPath: dockerSocketPath });

    // ------------------------------------------------------------
    // Database Helpers
    const createTestData = async () => {
        if(nodeEnv !== "production"){
            // count the entries in the deploy_targets table
            let count = parseInt((await sqlDatabase('deploy_targets').count('id as count').first()).count)
            
            if(count === 0){
                console.warn("creating default (dev) deploy target")
                // ah ah ah
                // create default deploy target
                await sqlDatabase('deploy_targets').insert({ 
                    id: crypto.randomUUID(),
                    name: "templ8",
                    packageName: "@cube-drone/templ8",
                    domain: 'groovelet.local',
                    subdomain: 'templ8',
                    enabled: true,
                    postgres: true,
                    redis: true,
                    redisMemory: 256,
                    created_at: new Date(),
                    updated_at: new Date()
                })
            }
        }
    }

    const getDeployTargets = async () => {
        let deployTargets = await sqlDatabase('deploy_targets')
            .select('*')
        return deployTargets
    }

    // ------------------------------------------------------------
    // Docker Helpers

    const dockerList = async () => {
        let contanersByPort = {}
        let containersByName = {}

        let dockerContainers = await docker.container.list({all: true})

        dockerContainers.forEach((container) => {
            let name = container.data.Names[0].replace(/^\//, "")
            let port
            if(container.data.Ports && container.data.Ports.length > 0){
                port = container.data.Ports[0].PublicPort
            }
            let state = container.data.State
            let status = container.data.Status
            let image = container.data.Image
            let containerObj = {
                name,
                port,
                state,
                status,
                image
            }
            if(state == "running"){
                // it's only occupying the port if it's running
                contanersByPort[port] = containerObj
            }
            containersByName[name] = containerObj 
        })

        return {
            byPort: contanersByPort,
            byName: containersByName
        }
    }

    const getPort = async () => {
        let {byPort} = await dockerList()
        // generate a range of numbers between minPort and maxPort
        let ports = []
        for(let i=minPort; i<=maxPort; i++){
            ports.push(i)
        }
        // remove any ports that are already in use
        ports = ports.filter((port) => {
            return !byPort[port]
        })
        if(ports.length === 0){
            throw new Error("No ports available")
        }
        // pick a random port from the list
        let port = ports[Math.floor(Math.random() * ports.length)];
        return port
    }

    const getContainer = async (name) => {
        let containers = await docker.container.list({all: true})
        let matchingContainers = containers.filter((container) => {
            return container.data.Names[0] === `/${name}`
        })
        if(matchingContainers.length === 0){
            return null
        }
        return matchingContainers[0]
    }

    const destroyContainer = async (name) => {
        console.warn(`destroying ${name}...`)
        let container = await getContainer(name)
        if(container){
            await container.delete({force: true})
            console.warn(`destroyed ${name}...`)
        }
        else{
            console.warn(`nothing to destroy at ${name}`)
        }
    }

    // ------------------------------------------------------------
    // NPM Helpers
    const getPackageVersions = async (packageName) => {
        let packageNameWithoutUser = packageName.split('/')[1]
        let packageType = "npm";
        let response = await axios.get(
            `${npmGitApiUrl}/user/packages/${packageType}/${packageNameWithoutUser}/versions`,
            {
                headers: {
                    'X-Github-Api-Version': '2022-11-28',
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `Bearer ${npmRegistryToken}`
                }
            });
        return response.data;
    }

    // ------------------------------------------------------------
    // Bringing It All Together

    const connectToDefaultNetwork = async(container) => {
        console.warn('connecting to default network...')
        let defaultNet = await docker.network.get("orchestr8")
        await defaultNet.connect({
            Container: container.id
        });
    }

    const checkPostgres = async (deployTarget) => {
        if(deployTarget.postgres){
            if(!deployTarget.postgresUrl){
                // this deployment wants a postgres but doesn't have one yet
                console.warn(`connection string: ${postgresConnectionString}`)
                let postgresUrl = connectionStringChangeDatabase(postgresConnectionString, deployTarget.name)            
                console.warn(`Creating database ${postgresUrl}...`)
                await connectAndSetup({postgresConnectionString: postgresUrl});

                let url = new URL(postgresUrl)
                let username = url.username
                let password = url.password

                let internalPostgresUrl = null
                if(postgresContainerName){
                    internalPostgresUrl = `postgres://${username}:${password}@${postgresContainerName}:5432/${deployTarget.name}`
                }

                await sqlDatabase('deploy_targets').update({
                    postgresUrl,
                    internalPostgresUrl
                }).where('id', deployTarget.id)
                deployTarget.postgresUrl = postgresUrl
                deployTarget.internalPostgresUrl = internalPostgresUrl
            }
        }

        return deployTarget
    }

    const deployRedis = async (deployTarget) => {
        let password = crypto.randomUUID();
        // this deployment wants a redis but doesn't have one yet
        let port = await getPort()
        // start docker container for redis
        console.log(`Starting redis container for ${deployTarget.name} on port ${port}`)
        
        // replace the redis with one that we control
        await destroyContainer(`${deployTarget.name}-redis`)
        
        // TODO: memory-restrict this redis from within redis
        // (build and mount a redis conf) 

        // pchoo pchoo
        console.log(`Creating redis container for ${deployTarget.name} on port ${port}`)
        let container = await getContainer(`${deployTarget.name}-redis`)
        if(container == null){
            container = await docker.container.create({
                Image: 'redis:alpine',
                name: `${deployTarget.name}-redis`,
                HostConfig: {
                    CpuShares: 1024,
                    Memory: deployTarget.redisMemory * 1024 * 1024,
                    RestartPolicy: {
                        Name: "unless-stopped"
                    },
                    PortBindings: {
                        "6379/tcp": [
                            {
                                HostPort: port.toString()
                            }
                        ]
                    }
                },
                Cmd: ['redis-server', 
                        '--requirepass', password, 
                        '--maxmemory', `${deployTarget.redisMemory-10}mb`]
            });
        }
        await connectToDefaultNetwork(container);
        
        console.log(`Starting container...`)
        await container.start()

        let redisUrl = `redis://:${password}@${hostName}:${port}`
        let internalRedisUrl = `redis://:${password}@${deployTarget.name}-redis:6379`
        await delay(500);
        
        console.log(`Testing redis container for ${deployTarget.name} on port ${port}`)
        let redis = new Redis(redisUrl);
        await redis.set("hello", "world", "EX", 60);
        let hello = await redis.get("hello")
        assert(hello === "world")
        console.warn(`\t success!`)

        console.log("ok!")

        // save the redisUrl against the deploy_target in the database (so that we can use it later)
        await sqlDatabase('deploy_targets').update({
            redisUrl, 
            internalRedisUrl
        }).where('id', deployTarget.id)

        deployTarget.redisUrl = redisUrl
        deployTarget.internalRedisUrl = internalRedisUrl
        return deployTarget
    }

    const checkRedis = async (deployTarget) => {
        // check if there's a redis container running for this deployment
        // if there isn't, start it and add its url to the deployTarget
        if(deployTarget.redis){
            if(!deployTarget.redisUrl){
                deployTarget = deployRedis(deployTarget)
            }
            else{
                console.log(`Redis already running for ${deployTarget.name}`)
            }
        }
        else{
            destroyContainer(`${deployTarget.name}-redis`)
        }
        return deployTarget
    }

    const deploy = async({deployTarget, version}) => {
        // pick a port for this deployment
        // does this deployment have a redis requirement?
        // does this deployment have a postgres requirement?
        // launch a container for this deployment
        // point openresty at the ports we're using
        
        // convert process.env into an array of X=Y strings:

        let Env = [
            "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin/node",
            "NODE_ENV=production",
            "PORT=9999",
            `COOKIE_SECRET=${cookieSecret}`,
        ]

        if(deployTarget.redis){
            let redisUrl = deployTarget.redisUrl
            if(deployTarget.internalRedisUrl){
                redisUrl = deployTarget.internalRedisUrl
            }

            Env.push(`REDIS_URL=${redisUrl}`)
        }
        if(deployTarget.postgres){
            let postgresUrl = deployTarget.postgresUrl
            if(deployTarget.internalPostgresUrl){
                postgresUrl = deployTarget.internalPostgresUrl
            }

            Env.push(`POSTGRES_URL=${postgresUrl}`)
        }

        let port = await getPort()
        await destroyContainer(`${deployTarget.name}-${version}`)

        console.warn(`deploying to port ${port}`)

        container = await docker.container.create({
            Image: "node:20",
            name: `${deployTarget.name}-${version}`,
            ExposedPorts: {
                "9999/tcp": {}
            },
            HostConfig: {
                PortBindings: {
                    "9999/tcp": [
                        {
                            HostPort: port.toString()
                        }
                    ]
                },
                CpuShares: 1024,
                Memory: deployTarget.nodeMemory * 1024 * 1024,
                RestartPolicy: {
                    Name: "unless-stopped"
                },
                Binds: [
                    `${process.env.HOME}/.npmrc:/.npmrc:ro`,
                ],
            },
            Env,
            Cmd: ['/usr/local/bin/npx', '-y', `${deployTarget.packageName}@${version}` ], 
            },
        );
        
        await connectToDefaultNetwork(container);
        
        console.log(`Starting container...`)
        await container.start()
    }

    const semverToInt = (version) => {
        /*
            this is a quick way to make semver strings sortable
            it will break a bit if you have more than 100000 patches, but.
            simply don't do that
        */
        let parts = version.split(".")
        let major = parseInt(parts[0])
        let minor = parseInt(parts[1])
        let patch = parseInt(parts[2])
        return major * 100000000 + minor * 100000 + patch
    }

    const getCurrentlyDeployedVersion = async ({deployTarget}) => {
        let mostRecentDeployment = await sqlDatabase('deployments')
            .where('deployTargetId', deployTarget.id)
            .where('active', true)
            .where('broken', false)
            .orderBy('semverSort', 'desc')
            .limit(10)
            .first()

        return mostRecentDeployment 
    }

    const isVersionOkay = async ({version, deployTarget}) => {
        /*
            a version is undeployable if there are any broken deployments using 
            that version
        */
        console.log(`testing version: ${version}`)
        let matchingDeployments = await sqlDatabase('deployments')
            .where('version', version)
            .where('deployTargetId', deployTarget.id)
            .where('broken', true)
        if(matchingDeployments.length === 0){
            return true;
        }
        else{
            return false;
        }
    }

    const checkNodes = async ({versionObjects, deployTarget}) => {
        console.log("getting best version...")
        let mostRecentDeployment = await getCurrentlyDeployedVersion({deployTarget})
        let versions = versionObjects.map(versionObject => versionObject.version)

        let bestVersion = null
        for(let candidateVersion of versions){
            let isValidCandidate = await isVersionOkay({version:candidateVersion, deployTarget})
            if(isValidCandidate){
                bestVersion = candidateVersion
                break
            }
        }
        
        if(versions.length == 0){
            throw new Error("Could not find any versions")
        }
        if(mostRecentDeployment && mostRecentDeployment.version == bestVersion){
            console.log("we're up to date, good")
            // we're up to date, good
            return;
        }
        else if(!mostRecentDeployment || 
            semverToInt(mostRecentDeployment.version) < semverToInt(bestVersion)){
            // there is not a currently deployed version at all for this target
            // or the currently deployed version is out of date
            //  so we should run a deploy with the most up to date version
            if(!mostRecentDeployment){
                console.log('no currently deployed version')
            }
            else{
                console.log(`currently deployed version: ${mostRecentDeployment.version}`)
            }
            console.log(`deploying ${bestVersion}`)
            await deploy({deployTarget, version: bestVersion})
        }
        else {
            // we've somehow got a deployed version further in the future than our 
            //  best possible version. Rollback to best possible version? Or do nothing? 
            return;
        }
    }

    const reconcileDeployTarget = async (deployTarget) => {
        // get a list of things running in docker
        try{
            let {byPort, byName} = await dockerList()
            //console.dir(byPort)
            //console.dir(byName)
            console.dir(deployTarget)
            
            let container = byName[deployTarget.name]
            let versionObjects = []
            try{
                versionObjects = await getPackageVersions(deployTarget.packageName)
            }
            catch(err){
                console.error(err)
                console.error(`Can't get package versions for ${deployTarget.name}, not doing anything`)
                return
            }
            versionObjects = versionObjects.map((versionObject) => {
                return {
                    version: versionObject.name,
                    created: versionObject.created_at
                }
            })
            //console.dir(versionObjects)
            
            if(deployTarget.enabled){
                // other checks here but we're going to skip past them for now
                deployTarget = await checkPostgres(deployTarget)
                deployTarget = await checkRedis(deployTarget)
                await checkNodes({deployTarget, versionObjects})            
            }
            else{
                // check if there are containers running for this deployment
                //   if there are, stop them
            }
        }
        catch(err){
            console.error(`Error reconciling ${deployTarget.name}`);
            console.error(err)
        }
    }

    const reconcile = async () => {
        let redisLock = await redis.set("reconcile-lock", "1", "NX", "EX", 70);
        if(!redisLock){
            console.log("Reconciliation already running.")
            return;
        }
        console.log("Running deploy reconciliation...");

        // get a list of products that we're supposed to be running
        let deployTargets = await getDeployTargets()

        await Promise.all(deployTargets.map(reconcileDeployTarget))

        // get a list of deployments: each one of this is active code that's running right now
        /*
        let deployments = await sqlDatabase('deployments')
            .select('deployments.*', 'deploy_targets.name', 'deploy_targets.packageName', 'deploy_targets.hostname')
            .join('deploy_targets', 'deployments.deployTargetId', 'deploy_targets.id')
            .where('deployments.active', true)
            .where('deploy_targets.enabled', true)
        */
        
        // for each deployment: is it running? is it healthy?
        
        await redis.unlink("reconcile-lock")
    }

    return {
        createTestData,
        reconcile,
    }
}