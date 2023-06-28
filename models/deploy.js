const fs = require('fs').promises;
const crypto = require('crypto');
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
    minPort=12000,
    maxPort=13000,
    memoryCap=8192,
    axiosTimeout=8000,
    npmGitApiUrl,
    npmRegistryUrl='https://npm.pkg.github.com',
    npmRegistryToken,
    alert,
    info,
    extraEnv,
    dockerSocketPath='/var/run/docker.sock'}) => {

    let docker = new Docker({ socketPath: dockerSocketPath });

    // ------------------------------------------------------------
    // Database Helpers
    const createData = async ({deploys}) => {
        /*
            deploys, here, is an object created from the config YAML file,
            describing how to deploy each package:

            deploys:
            - name: templ8
                packageName: "@cube-drone/templ8"
                domain: groovelet.com
                subdomain: templ8
                nginxPort: 9999
                nodeMemory: 2048
                nodes: 1
                enabled: true
                postgres: true
                redis: true
                redisMemory: 256
                env:
                  POOPS: TOOTSAHOY
                  CHUNKALUNK: DUNKALUNK

            our goal here is to create database entries for each of these,
            or, if they already exist, update them to match the config.

            if the config is missing a deploy target, we'll disable it.

            if the config is missing entirely, we'll just create some test data (templ8 ho!)
        */
        if(deploys == null){
            // count the entries in the deploy_targets table
            let count = parseInt((await sqlDatabase('deploy_targets').count('id as count').first()).count)

            if(count === 0){
                console.warn("Config is empty of deploy targets and no deploy targets exist, creating default test deploy target")
                // ah ah ah
                await sqlDatabase('deploy_targets').insert({
                    id: crypto.randomUUID(),
                    name: "templ8",
                    packageName: "@cube-drone/templ8",
                    domain: 'groovelet.local',
                    subdomain: 'templ8',
                    nodes: 2,
                    enabled: true,
                    postgres: true,
                    redis: true,
                    redisMemory: 256,
                    created_at: new Date(),
                    updated_at: new Date()
                })
            }
        }
        else{
            // create the deploy targets
            for(let deploy of deploys){
                let existingDeployTarget = await sqlDatabase('deploy_targets')
                    .where('name', deploy.name)
                    .first()

                if(existingDeployTarget == null){
                    let id = crypto.randomUUID();
                    await sqlDatabase('deploy_targets').insert({
                        id,
                        name: deploy.name,
                        packageName: deploy.packageName,
                        domain: deploy.domain,
                        subdomain: deploy.subdomain,
                        nginxPort: deploy.nginxPort,
                        nodeMemory: deploy.nodeMemory,
                        nodes: deploy.nodes,
                        enabled: deploy.enabled,
                        postgres: deploy.postgres,
                        redis: deploy.redis,
                        redisMemory: deploy.redisMemory,
                        created_at: new Date(),
                        updated_at: new Date()
                    })

                    // regardless of whether this is new or not, update the environment
                    await updateEnv({deployTarget: {id}, env: deploy.env})
                }
                else{
                    await sqlDatabase('deploy_targets')
                        .where('name', deploy.name)
                        .update({
                            packageName: deploy.packageName,
                            domain: deploy.domain,
                            subdomain: deploy.subdomain,
                            nginxPort: deploy.nginxPort,
                            nodeMemory: deploy.nodeMemory,
                            nodes: deploy.nodes,
                            enabled: deploy.enabled,
                            postgres: deploy.postgres,
                            redis: deploy.redis,
                            redisMemory: deploy.redisMemory,
                            updated_at: new Date()
                        })
                    if(deploy.postgresUrl){
                        await sqlDatabase('deploy_targets')
                            .where('name', deploy.name)
                            .update({
                                postgresUrl: deploy.postgresUrl
                            })
                    }
                    if(deploy.redisUrl){
                        await sqlDatabase('deploy_targets')
                            .where('name', deploy.name)
                            .update({
                                redisUrl: deploy.redisUrl
                            })
                    }
                    let id = existingDeployTarget.id
                    // regardless of whether this is new or not, update the environment
                    await updateEnv({deployTarget: {id}, env: deploy.env})
                }
            }
        }
    }

    const updateEnv = async ({deployTarget, env}) => {
        // update the env vars for a deploy target
        // first, delete the env
        await sqlDatabase('env')
            .where('deployTargetId', deployTarget.id)
            .delete()
        // then, insert the new env
        for(let key in env){
            await sqlDatabase('env').insert({
                id: crypto.randomUUID(),
                deployTargetId: deployTarget.id,
                key,
                value: env[key]
            })
        }
    }

    const getEnv = async ({deployTarget}) => {
        let env = await sqlDatabase('env')
            .where('deployTargetId', deployTarget.id)
            .select('*')
        // create an object with the keys and values of env:
        let envObject = {}
        for(let entry of env){
            envObject[entry.key] = entry.value
        }
        return envObject
    }

    const getDeployTargets = async () => {
        let deployTargets = await sqlDatabase('deploy_targets')
            .select('*')
        return deployTargets
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

    const getAllDeploymentsForVersion = async ({deployTarget, version}) => {
        let deployments = await sqlDatabase('deployments')
            .where('deployTargetId', deployTarget.id)
            .where('version', version)
        return deployments
    }
    const getLatestStableVersion = async ({deployTarget}) => {
        let mostRecentDeployment = await sqlDatabase('deployments')
            .where('deployTargetId', deployTarget.id)
            .where('stable', true).first()
        return mostRecentDeployment
    }

    const getActiveDeployments = async () => {
        // use a join to get the deployTarget name
        let activeDeployments = await sqlDatabase('deployments')
            .join('deploy_targets', 'deployments.deployTargetId', '=', 'deploy_targets.id')
            .select('deployments.*',
                'deploy_targets.name',
                'deploy_targets.packageName')
            .where('active', true)
            .where('broken', false)
        return activeDeployments
    }

    const createVersion = async ({deployTarget, version, url, internalUrl, discriminator, port}) => {
        let versionObject = {
            id: crypto.randomUUID(),
            deployTargetId: deployTarget.id,
            url,
            internalUrl,
            version,
            semverSort: semverToInt(version),
            discriminator,
            port,
            active: false,
            broken: false,
            stable: false,
            created_at: new Date(),
            updated_at: new Date()
        }
        await sqlDatabase('deployments').insert(versionObject)
        return versionObject
    }
    const createBrokenVersion = async ({deployTarget, version, problem}) => {
        let versionObject = {
            id: crypto.randomUUID(),
            deployTargetId: deployTarget.id,
            version,
            problem,
            semverSort: semverToInt(version),
            active: false,
            broken: true,
            stable: false,
            created_at: new Date(),
            updated_at: new Date()
        }
        await sqlDatabase('deployments').insert(versionObject)
        return versionObject
    }

    const setVersionToStable = async ({deployTarget, version}) => {
        await sqlDatabase('deployments')
            .where('deployTargetId', deployTarget.id)
            .where('version', version)
            .update({
                stable: true,
                updated_at: new Date()
            })
    }
    const setVersionToActive = async ({deployTarget, version}) => {
        await sqlDatabase('deployments')
            .where('deployTargetId', deployTarget.id)
            .where('version', version)
            .update({
                active: true,
                updated_at: new Date()
            })
        // set all other versions to inactive
        await sqlDatabase('deployments')
            .where('deployTargetId', deployTarget.id)
            .where('version', '!=', version)
            .update({
                active: false,
                updated_at: new Date()
            })
    }
    const setVersionToBroken = async ({deployTarget, version}) => {
        await sqlDatabase('deployments')
            .where('deployTargetId', deployTarget.id)
            .where('version', version)
            .update({
                broken: true,
                updated_at: new Date()
            })
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

    const getPort = async (candidatePort) => {
        /*
            this function will return a port that's not currently in use
            if candidatePort is provided, it will be used if it's available
        */
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
        if(candidatePort){
            if(ports.indexOf(candidatePort) != -1){
                return candidatePort
            }
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
        let packageType = "npm"
		console.warn(`getting package versions for ${packageNameWithoutUser}...`)
		console.log(`Bearer ${npmRegistryToken}`)
        let response = await axios.get(
            `${npmGitApiUrl}/user/packages/${packageType}/${packageNameWithoutUser}/versions`,
            {
                timeout: 10000,
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
        await destroyContainer(`O-${deployTarget.name}-redis`)

        // pchoo pchoo
        console.log(`Creating redis container for ${deployTarget.name} on port ${port}`)
        let container = await getContainer(`O-${deployTarget.name}-redis`)
        if(container == null){
            container = await docker.container.create({
                Image: 'redis:alpine',
                name: `O-${deployTarget.name}-redis`,
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

        let redisUrl = `redis://:${password}@localhost:${port}`
        let internalRedisUrl = `redis://:${password}@O-${deployTarget.name}-redis:6379`
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
            destroyContainer(`O-${deployTarget.name}-redis`)
        }
        return deployTarget
    }

    const loadBalancer = async ({deployTarget, version, deployedUrls, deployCode}) => {
        /*
            this function will update the load balancer to point at the given deployedUrls
        */
        let loadBalancerName = `O-${deployTarget.name}-nginx`

        // update the load balancer config
        let loadBalancerConfig = `
            upstream ${deployTarget.name} {
                ${deployedUrls.map(({url, internalUrl}) => {
                    return `server ${internalUrl.replace('http://', '')};`
                }).join("\n")}
            }

            server {
                listen 80  default_server;
                location / {
                    proxy_pass http://${deployTarget.name};

                    proxy_set_header Host $host;
                    proxy_set_header X-Real-IP $remote_addr;
                    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                    proxy_set_header X-Deploy ${deployCode};
                    proxy_set_header X-Deploy-Target ${deployTarget.name};
                    proxy_set_header X-Deploy-Version ${version};
                }
            }
        `
        let fullLoadBalancerConfig = `
        events{
            worker_connections 1024;
        }
        http{
            ${loadBalancerConfig}
        }
        `

        // now we need to update the load balancer config
        // create the .orchestr8 directory if it doesn't exist
        try {
            await fs.mkdir(`${process.env.HOME}/.orchestr8`)
        } catch(err){/* ignore */}

        let loadBalancerConfigPath = `${process.env.HOME}/.orchestr8/${deployTarget.name}.conf`
        await fs.writeFile(loadBalancerConfigPath, fullLoadBalancerConfig)

        let loadBalancer = await getContainer(loadBalancerName)
        if(loadBalancer == null){
            // create the load balancer
            console.log(`Creating load balancer for ${deployTarget.name}`)
            // start docker container for nginx
            let port = await getPort(deployTarget.nginxPort)
            let container = await docker.container.create({
                Image: 'nginx:alpine',
                name: loadBalancerName,
                HostConfig: {
                    CpuShares: 1024,
                    Memory: 256 * 1024 * 1024,
                    RestartPolicy: {
                        Name: "unless-stopped"
                    },
                    PortBindings: {
                        "80/tcp": [
                            {
                                HostPort: port.toString()
                            }
                        ]
                    },
                    //mount the config file to the location of nginx's config file
                    Binds: [
                        `${process.env.HOME}/.orchestr8/${deployTarget.name}.conf:/etc/nginx/nginx.conf:ro`,
                    ],
                },
                Cmd: ['nginx', '-g', 'daemon off;']
            });
            // save the port against the deploy_target in the database
            if(deployTarget.nginxPort != port){
                await sqlDatabase('deploy_targets').update({
                    nginxPort: port
                }).where('id', deployTarget.id)
            }

            await connectToDefaultNetwork(container);
            await container.start()
        }
        // restart the load balancer to pick up the new config
        console.log(`Restarting load balancer for ${deployTarget.name}`)
        loadBalancer = await getContainer(loadBalancerName)
        await loadBalancer.restart()
    }

    const launch = async({deployTarget, version, discriminator, timeoutSeconds=45}) => {
        /*
            this function will launch a container for the given deployTarget and version
            the container will be named O-${deployTarget.name}-node-${version}-${discriminator}
            (where the "discriminator" is used to differentiate between multiple containers)
        */
        info(`Launching ${deployTarget.name} version ${version} (${discriminator})`)

        let additionalEnv = await getEnv({deployTarget});

        let envList = Object.keys(additionalEnv).map((key) => {
            return `${key}=${additionalEnv[key]}`
        }).concat(Object.keys(extraEnv).map((key) => {
            return `${key}=${extraEnv[key]}`
        }))

        let Env = [
            ...envList,
            "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin/node",
            `NODE_ENV=${nodeEnv}`,
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

        console.warn(`deploying to port ${port}`)

        container = await docker.container.create({
            Image: "node:20",
            name: `O-${deployTarget.name}-node-${version}-${discriminator}`,
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

        let url = `http://${hostName}:${port}`
        let internalUrl = `http://O-${deployTarget.name}-node-${version}-${discriminator}:9999`

        await testNode({url, internalUrl, port, timeoutSeconds})
        console.log(`Success: container for ${deployTarget.name} on port ${port} responded!`)

        return {
            url,
            internalUrl,
            discriminator,
            port
        }
    }

    const deploy = async({deployTarget, version}) => {
        let deployCode = crypto.randomUUID().split('-')[0]
        let deployedUrls = []
        try{
            for(let i = 0; i < deployTarget.nodes; i++){
                let discriminator = `${deployCode}-${i.toString().padStart(2, "0")}`
                // each deployedUrl is a pair of `url` and `internalUrl`
                //  url is the externally accessible url
                //  internalUrl is the url that other containers should use to access this one
                deployedUrls.push(await launch({deployTarget, version, discriminator}))
            }
        }
        catch(err){
            // this would be where we'd mark this deploy as broken
            // we also need to clean up the failed deploy
            let containers = await dockerList()
            let deployedContainers = Object.values(containers.byName).filter((container) => {
                return container.name.startsWith(`O-${deployTarget.name}-node`) &&
                        container.name.indexOf(deployCode) != -1
            })
            await createBrokenVersion({
                deployTarget,
                version,
                problem: err.message.substring(0, 4086)
            })
            await Promise.all(deployedContainers.map((container) => {
                alert(`deploy failed, deleting ${container.name}`)
                return destroyContainer(container.name)
            }))
            throw err
        }
        // create the version object in the database
        for(let deployedUrl of deployedUrls){
            await createVersion({
                deployTarget,
                version,
                url: deployedUrl.url,
                internalUrl: deployedUrl.internalUrl,
                discriminator: deployedUrl.discriminator,
                port: deployedUrl.port
            })
        }
        // point the load balancer at the new deployment
        await loadBalancer({deployTarget, version, deployedUrls, deployCode})
        // mark the version as active
        await setVersionToActive({deployTarget, version})
        // destroy the containers of the old deployment
        let containers = await dockerList()
        let oldContainers = Object.values(containers.byName).filter((container) => {
            return container.name.startsWith(`O-${deployTarget.name}-node`) &&
                    container.name.indexOf(deployCode) == -1
        })
        await Promise.all(oldContainers.map((container) => {
            console.warn(`deleting ${container.name}`)
            return destroyContainer(container.name)
        }))
        info(`Deployed ${deployTarget.name} version ${version}`)
    }

    const deployLatestStable = async ({deployTarget}) => {
        let latestStableVersion = await getLatestStableVersion({deployTarget})
        if(latestStableVersion){
            await deploy({deployTarget, version: latestStableVersion.version})
        }
        else{
            throw new Error("No stable version to deploy")
        }
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

    const testNode = async ({url, internalUrl, port, timeoutSeconds=45}) => {
        let localUrl = `http://localhost:${port}`
        console.log(`Testing ${url} and ${internalUrl} and ${localUrl}...`)
        let connected = false
        let totalMs = 0
        while(!connected){
            try{
                if(url){
                    let response = await axios.get(`${url}/test`, {timeout: axiosTimeout})
                    if(response.status === 200){
                        connected = true
                        console.log(`Success: ${url} responded!`);
                    }
                }
            }
            catch(err){
                console.error(err.message);
                console.error(`... failed to connect to ${url}, trying again...`)
            }
            try{
                if(internalUrl){
                    let response = await axios.get(`${internalUrl}/test`, {timeout: axiosTimeout})
                    if(response.status === 200){
                        connected = true
                        console.log(`Success: ${internalUrl} responded!`);
                    }
                }
            }
            catch(err){
                console.error(err.message);
                console.error(`... failed to connect to ${internalUrl}, trying again...`)
            }
            try{
                if(localUrl){
                    let response = await axios.get(`${localUrl}/test`, {timeout: axiosTimeout})
                    if(response.status === 200){
                        connected = true
                        console.log(`Success: ${localUrl} responded!`);
                    }
                }
            }
            catch(err){
                console.error(err.message);
                console.error(`... failed to connect to ${localUrl}, trying again...`)
            }

            await delay(200)
            totalMs += 200
            if(totalMs > timeoutSeconds * 1000){
                throw new Error(`Timeout waiting for ${url} to respond`)
            }
        }
    }

    const testNodes = async ({deployTarget, version, timeoutSeconds=45}) => {
        console.warn(`testing all nodes for ${deployTarget.name}...`)
        let deployments = await getAllDeploymentsForVersion({deployTarget, version})
        for(let deployment of deployments){
            try{
                await testNode({
                    url: deployment.url,
                    internalUrl: deployment.internalUrl,
                    port: deployment.port,
                    timeoutSeconds
                })
                // it worked! increment the "pings" counter
                await sqlDatabase('deployments')
                    .where('id', deployment.id)
                    .update({
                        pings: deployment.pings + 1,
                        updated_at: new Date()
                    })
                if(deployment.pings + 1 > 10 && deployment.stable == false){
                    // this deployment is stable
                    console.log(`marking ${deployment.id} as stable`)
                    await setVersionToStable({deployTarget, version})
                }
            }
            catch(err){
                console.warn(`deployment ${deployment.id} is broken`)
                await setVersionToBroken({deployTarget, version})
                if(!deployment.stable){
                    alert(`rolling back to stable version`)
                    await deployLatestStable({deployTarget})
                }
                else{
                    alert(`deployTarget ${deployTarget.name} is broken with no stable version to roll back to!!!`)
                }
                return
            }
        }
        console.warn(`all deployments for ${deployTarget.name} are healthy`)
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
            else{
                console.log(`${deployTarget} version ${candidateVersion} is not okay`)
            }
        }

        if(bestVersion == null){
            throw new Error("Could not find any versions")
        }
        if(mostRecentDeployment && mostRecentDeployment.version == bestVersion){
            console.log("we're up to date, good")
            await testNodes({deployTarget, version: bestVersion})
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
            console.dir(deployTarget)

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

    let locked = false
    const reconcile = async () => {
		/*
			this is the core loop that we run regularly
		*/
        if(locked){
            console.log("Reconciliation already running.")
            return;
        }
        locked = true;

        try{
            console.log("Running deploy reconciliation...");

            // get a list of products that we're supposed to be running
            let deployTargets = await getDeployTargets()

            await Promise.all(deployTargets.map(reconcileDeployTarget))
        } finally {
            locked = false;
        }
    }

    const getStatusReport = async () => {
		/*
			this dumps a bunch of deployment information into a json object
			(it's used by the status page)
		*/
        let activeDeployments = await getActiveDeployments()
        let {byPort} = await dockerList()
        // inactive deployments
        let otherThings = await getDeployTargets()

        deployments = activeDeployments.map(deploy => {
            otherThings = otherThings.filter(thing => thing.name != deploy.name)
            deploy.container = byPort[deploy.port]
            deploy.fart = "toot"
            delete deploy.id
            delete deploy.deployTargetId
            delete deploy.url
            delete deploy.internalUrl
            delete deploy.container.port
            return deploy
        })

        otherThings = otherThings.map(thing => {
            return {
                name: thing.name,
                packageName: thing.packageName,
                enabled: thing.enabled,
                nodes: thing.nodes,
                domain: thing.domain,
                subdomain: thing.subdomain,
                port: thing.port,
                created_at: thing.created_at,
                updated_at: thing.updated_at,
                active: false,
            }

        })

        return [...deployments, ...otherThings]
    }

    const forgetAll = async () => {
        // delete everything from the deployments table
        // (leaving the table itself intact)
        await sqlDatabase('deployments').del()
        // this will cause the reconciliation loop to redeploy everything
    }

    return {
        createData,
        getActiveDeployments,
        reconcile,
        getStatusReport,
        forgetAll,
    }
}