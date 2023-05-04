let { task, desc } = require('jake');
let { run, runBg, pipe } = require('@cube-drone/rundmc');

desc("List all tools & options.")
task('default', async () => {
    return run("npx jake -T")
});

const setup = async () => {
    let {setup} = require('./index')
    await setup({
        nodeEnv: process.env.NODE_ENV || "development",
        redisUrl: process.env.TEMPL8_REDIS_URL || process.env.REDIS_URL ||
            "redis://localhost:6379",
        postgresConnectionString: process.env.TEMPL8_POSTGRES_URL || process.env.POSTGRES_URL ||
            "postgres://postgres:example@localhost:5432/templ8",
    })
}

desc("Build the database")
task('setup', setup)

const start = async () => {
    await run("docker-compose up -d")
    await setup()
    await run("nodemon run.js")
}
desc("Boot up the server.")
task('start', start)

desc("unbootup the server")
task('clean', async () => {
    await run("docker-compose down")
})

desc("load local secrets")
task('secrets', async () => {
    console.log("run 'source .secrets.sh' to load local secrets")
})

desc("run tests")
task('test', async () => {
    await run('npx mocha')
})

const cleanTest = async () => {
    await run("docker-compose down")
    await run("docker-compose up -d")
    await setup()
    let proc = runBg("node run.js")

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