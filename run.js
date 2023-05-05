let { main } = require('./index')

const nodeEnv = process.env.NODE_ENV || "development";
const envPort = process.env.ORCHESTR8_PORT || 9494;
const cookieSecret = process.env.ORCHESTR8_SECRET || "toots ahoy";
const redisUrl = process.env.ORCHESTR8_REDIS_URL || process.env.REDIS_URL || 
    "redis://localhost:6379";
const postgresConnectionString = process.env.ORCHESTR8_POSTGRES_URL || process.env.POSTGRES_URL || 
    "postgres://postgres:example@localhost:5432/orchestr8";

// take arguments and do various tasks:
// * start the server
// * setup the database
// * run tests

main({nodeEnv, envPort, cookieSecret, redisUrl, postgresConnectionString}).catch((err) => {
    console.error(err)
    process.exit(1)
})