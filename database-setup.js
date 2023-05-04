/*
    The important part at the beginning where we set up the database and tables
*/
let { run, runBg, pipe } = require('@cube-drone/rundmc')
let delay = require('delay')

async function connectWithoutDatabase(postgresConnectionString){
    /*
        Connect to the database without specifying a database name
        (we need this to create the database in the first place)
    */
    let pgConnectionStringWithoutDatabase = postgresConnectionString.replace(/\/[^\/]+$/, "");

    const sqlDatabase = require('knex')({
        client: 'pg',
        connection: pgConnectionStringWithoutDatabase,
    });  
    return sqlDatabase;
}

async function connect(postgresConnectionString){
    const sqlDatabase = require('knex')({
        client: 'pg',
        connection: postgresConnectionString,
    });  
    return sqlDatabase;
}

async function connectAndSetup({postgresConnectionString, retries = 5}){
    console.log("🗄️ - DATABASE");
    // this is just a log entry
    let pgConnectionSanitized = new URL(postgresConnectionString);
    pgConnectionSanitized.password = "****";
    console.log(`\tconnecting to ${pgConnectionSanitized.toString()}...`)
    
    // we need the databasename for stuff
    let pgConnectionUrl = new URL(postgresConnectionString);
    let databaseName = pgConnectionUrl.pathname.replace("/", "");

    let counter = 0;
    let sqlDatabase
    let databaseList
    while(counter <= retries){
        try{
            sqlDatabase = await connectWithoutDatabase(postgresConnectionString)
            databaseList = await sqlDatabase.raw("SELECT datname FROM pg_database")
            console.log("\tconnected to database")
        }
        catch(e){
            console.log(`\tfailed to connect to database, retrying in 1 second...`);
            await delay(1000);
            counter++;
            if(counter == retries){
                throw new Error("Could not connect to database");
            }
            continue;
        }
        break;
    }
    
    let databasesSet = new Set(databaseList.rows.map(row => row.datname));

    if(databasesSet.has(databaseName)){
        console.log(`\t${databaseName} exists, skipping creation`);
    }
    else{
        console.log(`\t${databaseName} does not exist, creating...`);
        await sqlDatabase.raw(`CREATE DATABASE ${databaseName}`);
    }

    await sqlDatabase.destroy();
    sqlDatabase = await connect(postgresConnectionString);

    return sqlDatabase;
}

module.exports = {
    connectAndSetup,
}
