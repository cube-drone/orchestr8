const {Docker} = require('node-docker-api');
const npmApi = require('npm-api');
const util = require('util');
const axios = require('axios');

module.exports = ({
    nodeEnv="development", 
    sqlDatabase, 
    redis, 
    minPort=12000,
    maxPort=13000,
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
                    hostname: "localhost",
                    enabled: true,
                    postgres: true,
                    redis: true,
                    redisMemory: 256
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
            let port = container.data.Ports[0].PublicPort
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

    const deploy = async({deployTarget, version}) => {
        // pick a port for this deployment
        // does this deployment have a redis requirement?
        // does this deployment have a postgres requirement?
        // launch a container for this deployment
        // point openresty at the ports we're using
    }

    const reconcileDeployTarget = async (deployTarget) => {
        // get a list of things running in docker
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
            await deploy({deployTarget, version: versionObjects[0]})            
        }
        else{
            // check if there are containers running for this deployment
            //   if there are, stop them
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