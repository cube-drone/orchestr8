/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.createTable('deploy_targets', function(table) {
        table.uuid('id').primary() 
        table.string('name', 256)                       // thing-to-deploy
        table.string('packageName', 256)                // @cube-drone/thing-to-deploy
        table.string('domain', 256)                     // groovelet.com
        table.string('subdomain', 256).nullable()       // auth
        table.integer('nodeMemory').defaultTo(2048)     // MB
        table.integer('nodes').defaultTo(1)             // number of node processes to run
        table.boolean('enabled').defaultTo(true)        // should the app be on at all?
        table.boolean('postgres').defaultTo(true)       // should the app get a postgres URL?
        table.string('postgresUrl', 256).nullable()     // postgres://localhost:5432/thing-to-deploy
        table.string('internalPostgresUrl', 256).nullable() 
        /*
            postgres and redis work differently, here: 
                we assume that postgres is hosted outside of orchestr8, 
                    and we just need to connect to it
                    (if the app requires that)
                so an app's postgres base url will be the same as the orchestrator's,
                    but they won't share a database
                    (so ours might be postgres.groovelet.com/orchestr8,
                    and theirs might be postgres.groovelet.com/thing-to-deploy)
                we assume that redis is hosted within orchestr8, and we need to deploy it
                so we need to keep track of where we put it and how much memory it has
        */
        table.boolean('redis').defaultTo(true)          // should we also deploy a redis?
        table.integer('redisMemory').defaultTo(256)     // MB
        table.string('redisUrl', 256).nullable()        // redis://localhost:6379
        table.string('internalRedisUrl', 256).nullable()
        table.string('redisHost', 256).nullable()       // orchestrator host
        table.timestamps() 
    })
    .createTable('deployments', function(table) {
        table.uuid('id').primary() 
        table.uuid('deployTargetId').references('id').inTable('deploy_targets') 
        table.string('host', 256)                   // this is the orchestrator host
        table.string('version', 256)                // 1.0.0
        table.integer('semverSort')                 // 1000000 (this is an integer version of the semver, for sorting)
        table.integer('port')                       // 8080
        table.boolean('active').defaultTo(true)     // "active" means it's running like this right now
        table.boolean('broken').defaultTo(false)    // if a deployment gets flagged as broken, it will be disabled
        table.boolean('stable').defaultTo(false)    
        /* 
            if a deployment runs for >30 mins without issues, 
            it becomes stable and is considered a viable backstop for rollbacks
        */
    })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema
        .dropTable('deployments')
        .dropTable('deploy_targets')
  
};
