/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.createTable('deploy_targets', function(table) {
        table.uuid('id').primary();
        table.string('name', 256);                  // thing-to-deploy
        table.string('packageName', 256);           // @cube-drone/thing-to-deploy
        table.string('hostname', 256);              // auth.groovelet.com
        table.boolean('enabled').defaultTo(true);
        table.boolean('postgres').defaultTo(true);
        table.boolean('redis').defaultTo(true);
        table.integer('redisMemory').defaultTo(256); // MB
        table.integer('nodeMemeory').defaultTo(2048); // MB
        table.timestamps();
    })
    .createTable('deployments', function(table) {
        table.uuid('id').primary();
        table.uuid('deployTargetId').references('id').inTable('deploy_targets');
        table.string('version', 256);               // 1.0.0
        table.integer('port');                      // 8080
        table.boolean('active').defaultTo(true);    // "active" means it's running like this right now
        table.boolean('broken').defaultTo(false);   // if a deployment gets flagged as broken, it will be disabled
    })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema
        .dropTable('deploy_targets')
  
};
