let { task, desc } = require('jake');
let { run, runBg, pipe } = require('@cube-drone/rundmc');

// if we're not running jake, then rundmc can run our tasks, instead
let isRunningJake = false;
for(let arg of process.argv){
    if(arg.indexOf("jake") > -1){
        isRunningJake = true;
    }
}
if(!isRunningJake){
    // monkey patch jake's task & desc
    task = require('@cube-drone/rundmc').task;
    desc = require('@cube-drone/rundmc').desc;
}

desc("List all tools & options.")
task('default', async () => {
    return run("npx jake -T")
});

const outdated = async () => {
    await run("npm outdated")
}
desc("List outdated dependencies.")
task('outdated', outdated)

const start = async () => {
    await run("docker-compose up -d")
    await run("nodemon bin.js")
}
desc("Boot up the server.")
task('start', start)

const forget = async () => {
    await run("docker-compose up -d")
    await run("ORCHESTR8_FORGET=true nodemon bin.js")
}
desc("Forget the deployment history of all the containers.")
task('forget', forget)

desc("unbootup the server")
task('clean', async () => {
    // remove .orchestr8
    await run("rm -rf ~/.orchestr8")
    // kill every container managed by orchestr8
    await run(`docker ps -a -q --filter="name=O-" | xargs docker rm -f`)
    // kill orchestr8's backing services
    await run("docker-compose down")
})

desc("run tests")
task('test', async () => {
    await run('npx mocha')
})

const cleanTest = async () => {
    await run("docker-compose down")
    await run("docker-compose up -d")
    await setup()
    let proc = runBg("node bin.js")

    let success = false
    let messages = []
    try{
        let tests = await pipe("npx mocha")
        console.warn("-----------------")
        for(let line of tests){
            console.log(line)
        }
        success = true
    }
    catch(err){
        console.log("Error running tests");
        for(let line of err){
            console.error(line)
            if(line.indexOf && line.indexOf("failing") > -1){
                messages.push(line)
            }
        }
    }

    if(messages){
        console.error("")
        for(let message of messages){
            console.error(`==> ${message}`)
        }
        console.error("")
    }

    await proc.kill()
    return { success, messages }
}

const ci_test = async () => {
    let { success, messages } = await cleanTest()
    if(!success){
        console.error("Tests failed, not deploying")
        return process.exit(1)
    }
    else{
        return process.exit(0)
    }
}
desc("Run the test suite from clean")
task('ci_test', ci_test)